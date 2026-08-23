import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

/**
 * Prueba de arrastrar y soltar, de extremo a extremo.
 *
 * Existe por un error concreto: un `FileList` no sobrevive al puente de
 * contextos —cruza como un proxy sin iterador— y `pathsFromDrop` devolvía una
 * lista vacía sin quejarse. La aplicación parecía entera y no importaba nada.
 * Ni las pruebas unitarias ni el arranque de humo podían verlo, porque el fallo
 * vive justo en la costura entre el renderizador y el preload.
 *
 * Aquí se suelta un archivo de verdad sobre la ventana de verdad: se inyecta un
 * File respaldado por el disco, se mete en un DataTransfer y se lanza el evento
 * `drop` que escucha la aplicación. Si la canción no acaba en la biblioteca,
 * esto falla.
 */
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUERTO = 9455;

/** WAV mínimo de silencio: no hace falta arrastrar fixtures al repositorio. */
function wavDeSilencio(segundos = 1) {
  const rate = 8000;
  const datos = Buffer.alloc(rate * segundos * 2);
  const cabecera = Buffer.alloc(44);
  cabecera.write('RIFF', 0, 4, 'ascii');
  cabecera.writeUInt32LE(36 + datos.length, 4);
  cabecera.write('WAVEfmt ', 8, 8, 'ascii');
  cabecera.writeUInt32LE(16, 16);
  cabecera.writeUInt16LE(1, 20);
  cabecera.writeUInt16LE(1, 22);
  cabecera.writeUInt32LE(rate, 24);
  cabecera.writeUInt32LE(rate * 2, 28);
  cabecera.writeUInt16LE(2, 32);
  cabecera.writeUInt16LE(16, 34);
  cabecera.write('data', 36, 4, 'ascii');
  cabecera.writeUInt32LE(datos.length, 40);
  return Buffer.concat([cabecera, datos]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const perfil = await mkdtemp(path.join(tmpdir(), 'pletina-arrastre-'));
const cancion = path.join(perfil, 'Pixies - Where Is My Mind.wav');
await writeFile(cancion, wavDeSilencio());

const headless = process.platform === 'linux' && !process.env.DISPLAY;
const argumentos = [raiz, '--no-sandbox', `--user-data-dir=${perfil}`,
  `--remote-debugging-port=${PUERTO}`, '--remote-allow-origins=*'];
const hijo = spawn(headless ? 'xvfb-run' : electron, headless ? ['-a', electron, ...argumentos] : argumentos, {
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  stdio: ['ignore', 'inherit', 'inherit'],
  detached: true,
});

const matar = () => {
  try {
    process.kill(-hijo.pid, 'SIGKILL');
  } catch {
    /* ya no está */
  }
};

async function terminar(codigo, mensaje) {
  console.log(mensaje);
  matar();
  await rm(perfil, { recursive: true, force: true }).catch(() => {});
  process.exit(codigo);
}

const guardia = setTimeout(() => terminar(1, 'ARRASTRE: la aplicación no ha respondido a tiempo'), 90000);

async function ventana() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const lista = await (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json();
      const pagina = lista.find((t) => t.type === 'page' && t.url.startsWith('pletina://'));
      if (pagina) return pagina;
    } catch {
      /* todavía no escucha */
    }
    await sleep(500);
  }
  throw new Error('la ventana no ha aparecido en el depurador');
}

const pagina = await ventana();
const ws = new WebSocket(pagina.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
let id = 0;
const esperando = new Map();
ws.onmessage = (evento) => {
  const mensaje = JSON.parse(evento.data);
  if (mensaje.id && esperando.has(mensaje.id)) {
    esperando.get(mensaje.id)(mensaje);
    esperando.delete(mensaje.id);
  }
};
const enviar = (method, params = {}) => new Promise((r) => {
  id += 1;
  esperando.set(id, r);
  ws.send(JSON.stringify({ id, method, params }));
});
async function evaluar(expression) {
  const r = await enviar('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'error');
  return r.result?.result?.value;
}

await sleep(4000);
await enviar('DOM.enable');

// Un File respaldado por el disco, que es lo único que `getPathForFile` sabe resolver.
await evaluar(`(() => {
  const i = document.createElement('input');
  i.type = 'file';
  i.id = 'sonda-arrastre';
  document.body.appendChild(i);
})()`);
const documento = await enviar('DOM.getDocument');
const nodo = await enviar('DOM.querySelector', { nodeId: documento.result.root.nodeId, selector: '#sonda-arrastre' });
await enviar('DOM.setFileInputFiles', { files: [cancion], nodeId: nodo.result.nodeId });

const cargado = await evaluar(`document.querySelector('#sonda-arrastre').files.length`);
if (cargado !== 1) await terminar(1, 'ARRASTRE: el depurador no ha podido inyectar el archivo');

// Y ahora el arrastre de verdad: el mismo evento que dispara el sistema.
await evaluar(`(() => {
  const archivo = document.querySelector('#sonda-arrastre').files[0];
  const dt = new DataTransfer();
  dt.items.add(archivo);
  window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
  window.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true }));
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
  document.querySelector('#sonda-arrastre').remove();
})()`);

let filas = 0;
for (let i = 0; i < 20; i += 1) {
  await sleep(500);
  filas = await evaluar('document.querySelectorAll(".row").length');
  if (filas > 0) break;
}

const ficha = await evaluar(`(() => {
  const fila = document.querySelector('.row');
  return fila ? {
    titulo: fila.querySelector('.t-title').textContent,
    artista: fila.querySelector('.t-artist').textContent,
  } : null;
})()`);

clearTimeout(guardia);
ws.close();

if (filas !== 1 || ficha?.titulo !== 'Where Is My Mind') {
  await terminar(1, `ARRASTRE: la canción no ha entrado en la biblioteca (filas=${filas}, ficha=${JSON.stringify(ficha)})`);
}
await terminar(0, `ARRASTRE: correcto · «${ficha.titulo}» de ${ficha.artista} importada al soltarla`);
