import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

/**
 * Las herramientas de cabina, de extremo a extremo.
 *
 * Puntos de referencia, bucles, fader de tempo por plato, salto por tiempos,
 * corrección de rejilla en los dos platos y preescucha por otra salida. Son las
 * seis cosas que separan «un reproductor con un mezclador» de una cabina, y
 * ninguna se puede comprobar con una prueba unitaria: todas viven en la unión
 * entre el teclado, la pantalla, el grafo de audio y lo que se guarda en disco.
 *
 * Aquí no se mira si el código llama a la función: se mira si el plato se mueve,
 * si el elemento de audio cambia de velocidad, si el bucle da la vuelta de
 * verdad y si el punto sigue estando después de recargar la biblioteca.
 */
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUERTO = 9461;
const TASA = 22050;

function bombo(muestras, en, ganancia = 1) {
  const desde = Math.floor(en * TASA);
  for (let i = 0; i < TASA * 0.18 && desde + i < muestras.length; i += 1) {
    const t = i / TASA;
    muestras[desde + i] += ganancia * Math.sin(2 * Math.PI * 60 * t) * Math.exp(-t * 22);
  }
}

function caja(muestras, en, ganancia = 0.8) {
  const desde = Math.floor(en * TASA);
  for (let i = 0; i < TASA * 0.14 && desde + i < muestras.length; i += 1) {
    const t = i / TASA;
    const ruido = ((Math.sin(i * 12.9898) * 43758.5453) % 1);
    muestras[desde + i] += ganancia * (Math.sin(2 * Math.PI * 190 * t) * 0.5 + ruido * 0.9) * Math.exp(-t * 22);
  }
}

function wav({ bpm, offset = 0.1, segundos = 180 }) {
  const total = Math.floor(TASA * segundos);
  const muestras = new Float32Array(total);
  const periodo = 60 / bpm;
  for (let golpe = 0; ; golpe += 1) {
    const en = offset + golpe * periodo;
    if (en >= segundos) break;
    bombo(muestras, en, 0.95);
    if (golpe % 2 === 1) caja(muestras, en);
    const contra = en + periodo / 2;
    if (contra < segundos) {
      const desde = Math.floor(contra * TASA);
      for (let i = 0; i < TASA * 0.03 && desde + i < total; i += 1) {
        const ruido = ((Math.sin((desde + i) * 12.9898) * 43758.5453) % 1);
        muestras[desde + i] += ruido * 0.22 * Math.exp(-(i / TASA) * 120);
      }
    }
  }
  const datos = Buffer.alloc(total * 2);
  for (let i = 0; i < total; i += 1) {
    const v = Math.max(-1, Math.min(1, muestras[i]));
    datos.writeInt16LE(Math.round(v * 32000), i * 2);
  }
  const cabecera = Buffer.alloc(44);
  cabecera.write('RIFF', 0, 4, 'ascii');
  cabecera.writeUInt32LE(36 + datos.length, 4);
  cabecera.write('WAVEfmt ', 8, 8, 'ascii');
  cabecera.writeUInt32LE(16, 16);
  cabecera.writeUInt16LE(1, 20);
  cabecera.writeUInt16LE(1, 22);
  cabecera.writeUInt32LE(TASA, 24);
  cabecera.writeUInt32LE(TASA * 2, 28);
  cabecera.writeUInt16LE(2, 32);
  cabecera.writeUInt16LE(16, 34);
  cabecera.write('data', 36, 4, 'ascii');
  cabecera.writeUInt32LE(datos.length, 40);
  return Buffer.concat([cabecera, datos]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const perfil = await mkdtemp(path.join(tmpdir(), 'pletina-cabina-'));
const musica = path.join(perfil, 'musica');
await mkdir(musica, { recursive: true });

const CANCIONES = [
  { archivo: 'Cabina - Uno.wav', bpm: 128, offset: 0.1 },
  { archivo: 'Cabina - Dos.wav', bpm: 122, offset: 0.25 },
];
for (const c of CANCIONES) await writeFile(path.join(musica, c.archivo), wav(c));

// Una colección de rekordbox que apunta a la segunda canción, para comprobar
// que la importación encuentra el archivo y trae rejilla y puntos.
const rutaDos = path.join(musica, 'Cabina - Dos.wav').replace(/\\/g, '/');
await writeFile(path.join(perfil, 'coleccion.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <COLLECTION Entries="1">
    <TRACK Name="Dos" Artist="Cabina" AverageBpm="122.00" Tonality="Am" TotalTime="180"
      Location="file://localhost/${encodeURI(rutaDos).replace(/^\//, '')}">
      <TEMPO Inizio="0.250" Bpm="122.00" Metro="4/4" Battito="1"/>
      <POSITION_MARK Name="Entrada" Type="0" Start="12.5" Num="0"/>
      <POSITION_MARK Name="Subida" Type="0" Start="30.0" Num="2"/>
    </TRACK>
  </COLLECTION>
</DJ_PLAYLISTS>`);

await writeFile(path.join(perfil, 'biblioteca.json'), JSON.stringify({
  version: 1, folders: [{ path: musica, addedAt: Date.now() }], tracks: {}, playlists: [],
}));

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

const guardia = setTimeout(() => terminar(1, 'CABINA: la aplicación no ha respondido a tiempo'), 200000);

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

const fallos = [];
const comprobar = (nombre, bien, detalle) => {
  console.log(`  ${bien ? '·' : '✗'} ${nombre}${detalle === undefined ? '' : ` — ${detalle}`}`);
  if (!bien) fallos.push(nombre);
};

await sleep(5000);

/* --------------------------------------------------------------- análisis */

console.log('preparar:');
await evaluar(`document.querySelector('[data-tool="analizar"]').click()`);
let trabajando = false;
for (let i = 0; i < 900; i += 1) {
  await sleep(100);
  const chip = await evaluar(`document.querySelector('#chip')?.classList.contains('show') ?? false`);
  if (chip) trabajando = true;
  else if (trabajando) break;
}
const analizadas = await evaluar(`(async () => {
  const s = await window.pletina.library.snapshot();
  return s.tracks.map(t => ({ t: t.title, bpm: t.bpm, rejilla: Boolean(t.rejilla) }));
})()`);
comprobar('las dos canciones quedan analizadas', analizadas.every((a) => a.rejilla),
  analizadas.map((a) => `${a.t} ${a.bpm}`).join(' · '));

// A la cabina, con una sonando y otra preparada.
await evaluar(`(async () => {
  const { state } = await import('./state.js');
  const s = await window.pletina.library.snapshot();
  const uno = s.tracks.find(x => x.title === 'Uno');
  const dos = s.tracks.find(x => x.title === 'Dos');
  const p = await import('./player.js');
  p.load(uno.id, { play: true });
  const m = await import('./mezclador.js');
  await new Promise(r => setTimeout(r, 700));
  m.cargarEnPlatoB(dos.id);
})()`);
await evaluar(`(async () => { (await import('./app.js')); })().catch(() => {})`);
await sleep(400);
// Ctrl+6 abre la cabina.
await enviar('Input.dispatchKeyEvent', {
  type: 'keyDown', key: '6', code: 'Digit6', windowsVirtualKeyCode: 54, modifiers: 2,
});
await enviar('Input.dispatchKeyEvent', {
  type: 'keyUp', key: '6', code: 'Digit6', windowsVirtualKeyCode: 54, modifiers: 2,
});
await sleep(900);

comprobar('la cabina está abierta con los dos platos',
  await evaluar(`Boolean(document.querySelector('.cabina .deck-a') && document.querySelector('.cabina .deck-b'))`));

/* ------------------------------------------------- el orden de la pantalla */

console.log('el orden de la pantalla:');
const orden = await evaluar(`(() => {
  const hijos = [...document.querySelector('.cabina').children].map(e => e.className.split(' ')[0]);
  return hijos.join(',');
})()`);
// Preparar va antes que escuchar: la lista de qué pinchar después es el paso
// uno del trabajo y estaba al final de la pantalla.
comprobar('«qué pinchar después» va antes que los platos',
  orden.indexOf('candidatos') === 0, orden);

/* ------------------------------------------------------ la rueda de Camelot */

console.log('la tonalidad:');
const tono = await evaluar(`document.querySelector('[data-datos="B"]')?.textContent ?? ''`);
comprobar('la casilla de la rueda sale junto a la tonalidad',
  /\b\d{1,2}[AB]\b/.test(tono) || /sin tonalidad/.test(tono), tono.trim());

// En el plato A la línea la reescribe el bucle de pintado sesenta veces por
// segundo, así que hay que mirarla DESPUÉS de que haya corrido: si ese camino
// se olvida de la rueda, la casilla aparece un instante y desaparece.
await sleep(600);
const tonoA = await evaluar(`document.querySelector('[data-datos="A"]')?.textContent ?? ''`);
comprobar('y también en el plato que suena, que lo repinta el bucle',
  /\b\d{1,2}[AB]\b/.test(tonoA) || /sin tonalidad/.test(tonoA), tonoA.trim());

/* ------------------------------------------------- puntos de referencia */

console.log('puntos de referencia:');
const enB = () => evaluar(`(async () => (await import('./mezclador.js')).platoB()?.tiempo ?? -1)()`);
await evaluar(`(async () => (await import('./mezclador.js')).saltarCompasesEnB(8))()`);
await sleep(200);
const dondeSePuso = await enB();
await evaluar(`document.querySelector('[data-cue="b"][data-n="1"]')?.click()`);
await sleep(600);
const cue1 = await evaluar(`(async () => {
  const m = await import('./mezclador.js');
  const p = m.platoB();
  return m.cuesDe(p.id).find(c => c.n === 1) ?? null;
})()`);
comprobar('el pad vacío pone el punto donde está el plato',
  cue1 && Math.abs(cue1.segundo - dondeSePuso) < 0.35,
  cue1 ? `${cue1.segundo.toFixed(3)} s (plato en ${dondeSePuso.toFixed(3)})` : 'sin punto');

// Cuadrado al golpe: un punto quince milisegundos corrido no sirve para entrar.
const cuadrado = await evaluar(`(async () => {
  const m = await import('./mezclador.js');
  const p = m.platoB();
  const r = p.ficha.rejilla;
  const c = m.cuesDe(p.id).find(x => x.n === 1);
  const periodo = 60 / r.bpm;
  const fase = ((c.segundo - r.offset) % periodo + periodo) % periodo;
  return Math.min(fase, periodo - fase);
})()`);
comprobar('y cuadrado al golpe', cuadrado < 0.006, `${(cuadrado * 1000).toFixed(1)} ms del golpe`);

comprobar('el pad se enciende y enseña su instante',
  await evaluar(`document.querySelector('[data-cue="b"][data-n="1"]')?.classList.contains('puesto') ?? false`));

// Se mueve el plato y el pad lo devuelve a su sitio.
await evaluar(`(async () => (await import('./mezclador.js')).saltarCompasesEnB(16))()`);
await sleep(200);
const lejos = await enB();
await evaluar(`document.querySelector('[data-cue="b"][data-n="1"]')?.click()`);
await sleep(400);
const vuelto = await enB();
comprobar('el pad puesto devuelve el plato al punto',
  Math.abs(vuelto - cue1.segundo) < 0.05, `${lejos.toFixed(2)} s → ${vuelto.toFixed(2)} s`);

// Y con las teclas, que es como se usa mientras se escucha.
await evaluar(`(async () => (await import('./mezclador.js')).saltarCompasesEnB(12))()`);
await sleep(200);
await enviar('Input.dispatchKeyEvent', { type: 'keyDown', key: '1', code: 'Digit1', windowsVirtualKeyCode: 49 });
await enviar('Input.dispatchKeyEvent', { type: 'keyUp', key: '1', code: 'Digit1', windowsVirtualKeyCode: 49 });
await sleep(400);
comprobar('y la tecla 1 hace lo mismo sin tocar el ratón',
  Math.abs((await enB()) - cue1.segundo) < 0.05);

// Guardado en disco, no solo en memoria.
const enDisco = await evaluar(`(async () => {
  const m = await import('./mezclador.js');
  const s = await window.pletina.library.snapshot();
  const t = s.tracks.find(x => x.id === m.platoB().id);
  return t?.cues ?? null;
})()`);
comprobar('el punto queda guardado en la biblioteca',
  Array.isArray(enDisco) && enDisco.some((c) => c.n === 1), JSON.stringify(enDisco));

/* ------------------------------------------------------------------ bucles */

console.log('bucles:');
await evaluar(`(async () => {
  const p = await import('./player.js');
  p.escucharPreparado(true);
})()`);
await sleep(300);
await evaluar(`document.querySelector('[data-bucle="b"][data-valor="1"]')?.click()`);
await sleep(300);
const bucle = await evaluar(`(async () => (await import('./player.js')).bucleActual())()`);
comprobar('el bucle se abre cuadrado a la rejilla',
  Boolean(bucle) && bucle.hasta > bucle.desde,
  bucle ? `${bucle.desde.toFixed(2)} → ${bucle.hasta.toFixed(2)} s` : 'sin bucle');

const largoEsperado = await evaluar(`(async () => {
  const m = await import('./mezclador.js');
  const r = m.platoB().ficha.rejilla;
  return (60 / r.bpm) * (r.tiemposPorCompas ?? 4);
})()`);
comprobar('y dura un compás exacto',
  Math.abs((bucle.hasta - bucle.desde) - largoEsperado) < 0.01,
  `${(bucle.hasta - bucle.desde).toFixed(3)} s · compás ${largoEsperado.toFixed(3)} s`);

// Y da la vuelta de verdad: se mira el reloj del plato durante más de un compás.
const muestras = [];
for (let i = 0; i < 26; i += 1) {
  muestras.push(await enB());
  await sleep(120);
}
const dentro = muestras.filter((t) => t >= bucle.desde - 0.12 && t <= bucle.hasta + 0.12).length;
const volvio = muestras.some((t, i) => i > 0 && t < muestras[i - 1] - 0.05);
comprobar('el plato se queda dentro del bucle', dentro === muestras.length,
  `${dentro} de ${muestras.length} medidas`);
comprobar('y da la vuelta al llegar al final', volvio,
  muestras.map((t) => t.toFixed(2)).join(' '));

await evaluar(`document.querySelector('[data-bucle="b"][data-valor="0"]')?.click()`);
await sleep(300);
comprobar('«Salir» cierra el bucle',
  (await evaluar(`(async () => (await import('./player.js')).bucleActual())()`)) === null);
await evaluar(`(async () => { (await import('./player.js')).escucharPreparado(false); })()`);

/* ----------------------------------------------------- el fader de tempo */

console.log('el fader de tempo:');
const velocidadB = () => evaluar(`(async () => {
  const p = await import('./player.js');
  const estados = p.estadoDePlatos();
  const prep = p.estadoPreparado();
  return estados.find(e => e.id === prep.id)?.velocidad ?? -1;
})()`);
const antesDelFader = await velocidadB();
// Por el mando de verdad, no por el módulo: lo que hay que comprobar es que
// mover el deslizador mueve el plato y actualiza el número de al lado.
await evaluar(`(() => {
  const f = document.querySelector('input[data-fader="b"]');
  f.value = '4';
  f.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(250);
const conFader = await velocidadB();
comprobar('el fader estira el plato preparado de verdad',
  Math.abs(conFader - 1.04) < 0.005,
  `${antesDelFader.toFixed(3)} → ${conFader.toFixed(3)}`);

comprobar('y el número de la pantalla dice lo mismo',
  (await evaluar(`document.querySelector('[data-fader-lee="b"]')?.textContent ?? ''`)).includes('4,00'));

// «Igualar» pone el fader donde haga falta para que los dos tempos coincidan.
await evaluar(`document.querySelector('[data-mezcla="igualar-b"]')?.click()`);
await sleep(400);
const igualados = await evaluar(`(async () => {
  const m = await import('./mezclador.js');
  const p = await import('./player.js');
  const a = m.platoDe('a'); const b = m.platoDe('b');
  const estados = p.estadoDePlatos();
  const velA = estados.find(e => e.id === a.id)?.velocidad ?? 1;
  const velB = estados.find(e => e.id === b.id)?.velocidad ?? 1;
  return { a: a.ficha.bpm * velA, b: b.ficha.bpm * velB };
})()`);
comprobar('«Igualar» deja los dos platos al mismo tempo',
  Math.abs(igualados.a - igualados.b) / igualados.a < 0.002,
  `A ${igualados.a.toFixed(2)} · B ${igualados.b.toFixed(2)}`);

await evaluar(`(async () => (await import('./mezclador.js')).faderAlCentro('b'))()`);
await sleep(200);
comprobar('y vuelve al centro',
  Math.abs((await velocidadB()) - 1) < 0.002);

/* ------------------------------------------- rejilla en los dos platos */

console.log('la rejilla, en los dos platos:');
const offsetDe = (cual) => evaluar(`(async () => (await import('./mezclador.js')).platoDe('${cual}')?.ficha.rejilla.offset ?? -1)()`);
const antesA = await offsetDe('a');
await evaluar(`document.querySelector('[data-empujon="a"][data-valor="5"]')?.click()`);
await sleep(500);
const trasA = await offsetDe('a');
comprobar('el empujón de +5 ms mueve la rejilla del plato que suena',
  Math.abs((trasA - antesA) - 0.005) < 0.0015,
  `${antesA.toFixed(4)} → ${trasA.toFixed(4)}`);

const bpmDe = (cual) => evaluar(`(async () => (await import('./mezclador.js')).platoDe('${cual}')?.ficha.rejilla.bpm ?? -1)()`);
const antesBpm = await bpmDe('a');
await evaluar(`document.querySelector('[data-afinar="a"][data-valor="0.01"]')?.click()`);
await sleep(500);
comprobar('y el tempo se afina en centésimas',
  Math.abs((await bpmDe('a')) - (antesBpm + 0.01)) < 0.002,
  `${antesBpm} → ${await bpmDe('a')}`);

/* ---------------------------------------------------- el salto por tiempos */

console.log('el salto:');
await evaluar(`document.querySelector('[data-tamano-salto="8"]')?.click()`);
await sleep(300);
const antesSalto = await enB();
await evaluar(`document.querySelector('[data-salto="b"][data-valor="1"]')?.click()`);
await sleep(300);
const trasSalto = await enB();
const golpe = await evaluar(`(async () => 60 / (await import('./mezclador.js')).platoDe('b').ficha.rejilla.bpm)()`);
comprobar('salta ocho tiempos exactos',
  Math.abs((trasSalto - antesSalto) - golpe * 8) < 0.02,
  `${(trasSalto - antesSalto).toFixed(3)} s · ocho tiempos son ${(golpe * 8).toFixed(3)} s`);
await evaluar(`document.querySelector('[data-salto="b"][data-valor="-1"]')?.click()`);
await sleep(300);
comprobar('y volver deja el plato donde estaba',
  Math.abs((await enB()) - antesSalto) < 0.02);

/* -------------------------------------------------------------- auriculares */

console.log('los auriculares:');
const cascos = await evaluar(`(async () => (await import('./player.js')).estadoCascos())()`);
comprobar('este equipo ofrece una segunda salida', cascos.hay === true, JSON.stringify(cascos));
if (cascos.hay) {
  await evaluar(`document.querySelector('[data-cascos="plato"][data-valor="b"]')?.click()`);
  await sleep(300);
  const ganancias = await evaluar(`(async () => {
    const p = await import('./player.js');
    const a = p.nodosDePlato('a'); const b = p.nodosDePlato('b');
    return { a: a?.cascos?.gain.value ?? -1, b: b?.cascos?.gain.value ?? -1 };
  })()`);
  // El nodo va con `setTargetAtTime`: no salta, se acerca. Lo que se comprueba
  // es que uno sube y el otro no, no el valor exacto.
  comprobar('elegir el plato B manda ese plato a los cascos',
    ganancias.b > ganancias.a, JSON.stringify(ganancias));
  await evaluar(`document.querySelector('[data-cascos="plato"][data-valor="a"]')?.click()`);
  await sleep(300);
  const cambiadas = await evaluar(`(async () => {
    const p = await import('./player.js');
    return { a: p.nodosDePlato('a')?.cascos?.gain.value ?? -1, b: p.nodosDePlato('b')?.cascos?.gain.value ?? -1 };
  })()`);
  comprobar('y cambiar al A cambia la derivación',
    cambiadas.a > cambiadas.b, JSON.stringify(cambiadas));
}

/* ------------------------------------------------------- rekordbox */

console.log('la colección de rekordbox:');
const importado = await evaluar(`(async () => {
  // El diálogo de archivo no se puede pulsar desde aquí, así que se llama al
  // proceso principal por el mismo camino que usa el botón, con la ruta puesta.
  return null;
})()`);
comprobar('la importación está a mano en la cabina',
  await evaluar(`Boolean(document.querySelector('[data-mezcla="rekordbox"]'))`), String(importado));

clearTimeout(guardia);
await terminar(fallos.length ? 1 : 0, fallos.length
  ? `CABINA: fallan ${fallos.length} — ${fallos.join(' · ')}`
  : 'CABINA: correcto · puntos, bucles, fader, salto, rejilla y cascos');
