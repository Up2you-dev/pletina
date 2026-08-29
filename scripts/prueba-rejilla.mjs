import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

/**
 * Prueba de la rejilla, las teclas y las ondas, de extremo a extremo.
 *
 * Existe por tres quejas seguidas del mismo usuario: que las ondas no se ven,
 * que hay teclas que no hacen nada y que la aplicación es mediocre cuadrando y
 * analizando. Las tres cosas se pueden comprobar sin oídos, y ninguna se veía
 * en las pruebas unitarias porque las tres viven en la unión: el análisis
 * escribe, la biblioteca guarda, el visor lee y el teclado dispara.
 *
 * Se fabrican dos canciones difíciles a propósito —una con el bombo solo en el
 * uno y el tres, que es donde un detector dice la mitad del tempo— y se mira
 * qué número sale, dónde caen los golpes, si la onda tiene tinta y si las
 * teclas llegan.
 */
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUERTO = 9459;
const TASA = 22050;

/** Un golpe grave que decae: el bombo. */
function bombo(muestras, en, ganancia = 1) {
  const desde = Math.floor(en * TASA);
  for (let i = 0; i < TASA * 0.18 && desde + i < muestras.length; i += 1) {
    const t = i / TASA;
    muestras[desde + i] += ganancia * Math.sin(2 * Math.PI * 60 * t) * Math.exp(-t * 22);
  }
}

/** Un golpe con cuerpo y ruido: la caja. Vive arriba, fuera de la banda grave. */
function caja(muestras, en, ganancia = 0.8) {
  const desde = Math.floor(en * TASA);
  for (let i = 0; i < TASA * 0.14 && desde + i < muestras.length; i += 1) {
    const t = i / TASA;
    const ruido = ((Math.sin(i * 12.9898) * 43758.5453) % 1);
    muestras[desde + i] += ganancia * (Math.sin(2 * Math.PI * 190 * t) * 0.5 + ruido * 0.9) * Math.exp(-t * 22);
  }
}

/**
 * Una canción con patrón de verdad: el bombo en los tiempos que se digan y la
 * caja en los otros. Con el bombo solo en el uno y el tres, la banda grave
 * parece ir a la mitad de velocidad de lo que va la canción; ahí es donde el
 * análisis se equivocaba de octava y decía 65 de una canción de 130.
 */
// Tres minutos: la prueba dura lo suyo y con canciones cortas se acababa la
// música a mitad de recorrido, con lo que fallaban comprobaciones que no tenían
// nada que ver —los platos vacíos porque sí—.
function wav({ bpm, offset = 0.1, segundos = 180, bomboEn = [0, 2], cajaEn = [1, 3] }) {
  const total = Math.floor(TASA * segundos);
  const muestras = new Float32Array(total);
  const periodo = 60 / bpm;
  for (let golpe = 0; ; golpe += 1) {
    const en = offset + golpe * periodo;
    if (en >= segundos) break;
    const enCompas = golpe % 4;
    if (bomboEn.includes(enCompas)) bombo(muestras, en, 0.95);
    if (cajaEn.includes(enCompas)) caja(muestras, en);
    // Charles a corcheas, para que la banda aguda tenga algo que dibujar.
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
const perfil = await mkdtemp(path.join(tmpdir(), 'pletina-rejilla-'));
const musica = path.join(perfil, 'musica');
await mkdir(musica, { recursive: true });

// Dos canciones con el bombo espaciado: el caso que salía a la mitad de tempo.
const CANCIONES = [
  { archivo: 'Sala Dos - Garage.wav', bpm: 130, offset: 0.1 },
  { archivo: 'Sala Dos - Lento.wav', bpm: 92.5, offset: 0.37 },
];
for (const c of CANCIONES) await writeFile(path.join(musica, c.archivo), wav(c));
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

const guardia = setTimeout(() => terminar(1, 'REJILLA: la aplicación no ha respondido a tiempo'), 180000);

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

console.log('analizar:');
await evaluar(`document.querySelector('[data-tool="analizar"]').click()`);
let trabajando = false;
for (let i = 0; i < 900; i += 1) {
  await sleep(100);
  const chip = await evaluar(`document.querySelector('#chip')?.classList.contains('show') ?? false`);
  if (chip) trabajando = true;
  else if (trabajando) break;
}

const fichas = await evaluar(`(async () => {
  const s = await window.pletina.library.snapshot();
  return s.tracks.map(t => ({ titulo: t.title, bpm: t.bpm, rejilla: t.rejilla, onda: t.onda }));
})()`);
const porTitulo = Object.fromEntries(fichas.map((f) => [f.titulo, f]));

for (const { archivo, bpm, offset } of CANCIONES) {
  const titulo = archivo.replace('.wav', '').split(' - ')[1];
  const ficha = porTitulo[titulo];
  const error = ficha?.bpm ? Math.abs(ficha.bpm - bpm) / bpm : 1;
  comprobar(`«${titulo}» sale en su octava`, error < 0.005,
    `${ficha?.bpm?.toFixed(2) ?? '—'} bpm (se fabricó a ${bpm})`);

  // Y los golpes de la rejilla caen encima de los bombos de verdad.
  const periodo = 60 / (ficha?.rejilla?.bpm || 1);
  const resto = ((offset - (ficha?.rejilla?.offset ?? 0)) % periodo + periodo) % periodo;
  const desfase = Math.min(resto, periodo - resto);
  comprobar(`y sus golpes caen donde el bombo`, desfase < 0.02, `${Math.round(desfase * 1000)} ms de error`);
  comprobar(`y se fía de su propia rejilla`, (ficha?.rejilla?.fuerza ?? 0) > 0.25,
    `fuerza ${ficha?.rejilla?.fuerza}, deriva ${ficha?.rejilla?.deriva}`);
  comprobar(`y deja la onda guardada`, ficha?.onda === true);
}

/* ------------------------------------------------------- octava a mano */

console.log('corregir a mano:');
await evaluar(`(async () => {
  const s = await window.pletina.library.snapshot();
  const t = s.tracks.find(x => x.title === 'Garage');
  return window.pletina.track.rejilla(t.id, { factor: 2 });
})()`);
const doblada = await evaluar(`(async () => {
  const s = await window.pletina.library.snapshot();
  const t = s.tracks.find(x => x.title === 'Garage');
  return { bpm: t.bpm, rejilla: t.rejilla };
})()`);
comprobar('el ×2 cuenta el tempo al doble', Math.abs(doblada.bpm - 260) < 2,
  `${doblada.bpm?.toFixed(2)} bpm`);
{
  // Y sin mover un golpe: el bombo de verdad sigue cayendo en la rejilla.
  const periodo = 60 / doblada.rejilla.bpm;
  const resto = ((0.1 - doblada.rejilla.offset) % periodo + periodo) % periodo;
  comprobar('y no mueve un solo golpe de sitio', Math.min(resto, periodo - resto) < 0.02,
    `${Math.round(Math.min(resto, periodo - resto) * 1000)} ms`);
}
await evaluar(`(async () => {
  const s = await window.pletina.library.snapshot();
  const t = s.tracks.find(x => x.title === 'Garage');
  return window.pletina.track.rejilla(t.id, { factor: 0.5 });
})()`);
const vuelta = await evaluar(`(async () => {
  const s = await window.pletina.library.snapshot();
  return s.tracks.find(x => x.title === 'Garage').bpm;
})()`);
comprobar('y el ÷2 deshace el cambio', Math.abs(vuelta - 130) < 1, `${vuelta?.toFixed(2)} bpm`);

/* ------------------------------------------------------------- las ondas */

console.log('las ondas:');
// Se pone una a sonar y la otra en el plato B: así los dos platos tienen onda.
await evaluar(`(async () => {
  const st = await import('./state.js');
  const fila = [...document.querySelectorAll('.row')].find(f => f.textContent.includes('Garage'));
  fila.querySelector('.idx').click();
  return true;
})()`);
await sleep(1200);
await evaluar(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('Mezclador')).click()`);
await sleep(900);
await evaluar(`(async () => {
  const m = await import('./mezclador.js');
  const s = await window.pletina.library.snapshot();
  const otra = s.tracks.find(x => x.title === 'Lento');
  await m.cargarEnPlatoB(otra.id);
  return true;
})()`);
await sleep(1400);

const tinta = async (cual) => evaluar(`(() => {
  const c = document.querySelector('[data-onda="${cual}"]');
  if (!c) return -1;
  const datos = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let pintados = 0;
  for (let i = 3; i < datos.length; i += 4) if (datos[i] > 8) pintados += 1;
  return Math.round((pintados / (datos.length / 4)) * 100);
})()`);
for (const cual of ['zoom-a', 'general-a', 'zoom-b', 'general-b']) {
  const cuanta = await tinta(cual);
  comprobar(`la onda «${cual}» tiene dibujo`, cuanta > 2, `${cuanta} % del lienzo`);
}

// Y con las bandas separadas: si todo saliera del mismo color, el visor no
// serviría para nada de lo que sirve.
const colores = await evaluar(`(() => {
  const c = document.querySelector('[data-onda="zoom-a"]');
  const datos = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const vistos = new Set();
  for (let i = 0; i < datos.length; i += 4) {
    if (datos[i + 3] < 64) continue;
    vistos.add(datos[i] + ',' + datos[i + 1] + ',' + datos[i + 2]);
  }
  return vistos.size;
})()`);
comprobar('con las tres bandas de distinto color', colores >= 3, `${colores} colores`);

// La rejilla tiene que VERSE ENCIMA DE LA ONDA, no en el hueco de arriba.
//
// La prueba de antes contaba píxeles con alfa en la franja superior, donde la
// onda no llega nunca: certificaba que se escribía tinta justo donde la rejilla
// era legible y callaba sobre el 84 % central, que es donde el usuario mira y
// donde la línea se fundía con la onda. Ahora se mide el SALTO DE LUMINANCIA
// entre la columna de la línea y sus vecinas, a media altura, y en los dos
// temas: es lo que decide si el ojo la ve.
const contrasteDeRejilla = async (cual, tema) => {
  await evaluar(`(() => { document.documentElement.setAttribute('data-theme', '${tema}'); return true; })()`);
  // Con la música parada: el plato que suena se mueve entre que se calcula
  // dónde caen las líneas y que se leen los píxeles, y entonces se mide el
  // color de otro sitio. Lo que se comprueba aquí es el contraste, no el
  // movimiento.
  await evaluar(`(async () => { (await import('./player.js')).pause(); })()`);
  await sleep(700);
  return evaluar(`(async () => {
    const m = await import('./mezclador.js');
    const st = await import('./state.js');
    const ov = await import('../shared/onda-vista.js');
    const p = await import('./player.js');
    const ficha = '${cual}' === 'a' ? m.fichaDeMezcla(st.state.currentId) : m.platoB()?.ficha;
    const centro = '${cual}' === 'a' ? p.currentTime() : (m.platoB()?.tiempo ?? 0);
    const { desde, hasta } = ov.ventana(centro, 8);
    const lineas = ov.lineasDeRejilla(ficha?.rejilla ?? null, { desde, hasta });
    const c = document.querySelector('[data-onda="zoom-${cual}"]');
    const razon = c.width / c.getBoundingClientRect().width;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const lum = (x, y) => {
      const i = (Math.round(y) * c.width + Math.round(x)) * 4;
      const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(d[i]) + 0.7152 * f(d[i + 1]) + 0.0722 * f(d[i + 2]);
    };
    const contraste = (a, b) => { const [x, y] = [a, b].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const alturas = [c.height * 0.5, c.height * 0.35, c.height * 0.65];
    const saltos = [];
    for (const linea of lineas) {
      if (linea.tipo === 'golpe') continue;
      const x = ov.xDeSegundo(linea.segundo, { desde, hasta, ancho: c.width / razon }) * razon;
      if (x < 12 || x > c.width - 12) continue;
      // El peor de los tres cortes: si en alguno se funde, no vale.
      let peor = Infinity;
      for (const y of alturas) {
        const dentro = Math.max(lum(x, y), lum(x - 1, y), lum(x + 1, y));
        const fuera = Math.min(lum(x - 7, y), lum(x + 7, y));
        peor = Math.min(peor, contraste(dentro, fuera));
      }
      saltos.push(Math.round(peor * 100) / 100);
    }
    return { lineas: lineas.length, unos: saltos.length, saltos, peor: saltos.length ? Math.min(...saltos) : 0 };
  })()`);
};

for (const tema of ['light', 'dark']) {
  for (const cual of ['a', 'b']) {
    const medida = await contrasteDeRejilla(cual, tema);
    comprobar(`la rejilla del plato ${cual.toUpperCase()} se ve sobre la onda (tema ${tema})`,
      // Un compás basta: el plato preparado está aparcado al principio de la
      // canción y en su ventana no caben más. Lo que se exige es el contraste.
      medida.unos >= 1 && medida.peor >= 3,
      `${medida.unos} compases · peor contraste ${medida.peor}:1`);
  }
}
await evaluar(`(() => { document.documentElement.setAttribute('data-theme', 'dark'); return true; })()`);
await evaluar(`(async () => { (await import('./player.js')).start(); })()`);
await sleep(600);

// Y el ×2 de la cabina, pulsándolo como se pulsa: el botón tiene que estar
// vivo, la orden llegar y el número cambiar en la ficha del plato.
const bpmDeB = () => evaluar(`(async () => (await import('./mezclador.js')).platoB()?.ficha?.bpm ?? 0)()`);
const antesDelDoble = await bpmDeB();
await evaluar(`document.querySelector('[data-octava="b"][data-valor="2"]')?.click()`);
await sleep(900);
const doble = await bpmDeB();
comprobar('el botón ×2 de la cabina dobla el tempo del plato B',
  Math.abs(doble - antesDelDoble * 2) < 1, `${antesDelDoble.toFixed(2)} → ${doble.toFixed(2)} bpm`);
await evaluar(`document.querySelector('[data-octava="b"][data-valor="0.5"]')?.click()`);
await sleep(900);
comprobar('y el ÷2 lo devuelve', Math.abs((await bpmDeB()) - antesDelDoble) < 1,
  `${(await bpmDeB()).toFixed(2)} bpm`);

// Un plato sin canción dice qué hacer, en vez de quedarse en blanco.
await evaluar(`(async () => { (await import('./mezclador.js')).soltarPlatoB(); })()`);
await sleep(700);
const vacio = await tinta('zoom-b');
comprobar('un plato vacío no se queda mudo', vacio > 0 && vacio < 5, `${vacio} % (el aviso escrito)`);

/* ------------------------------------------------------ elegir qué preparar */

console.log('elegir qué preparar:');
await evaluar(`(async () => { (await import('./mezclador.js')).soltarPlatoB(); })()`);
await sleep(500);

// El buscador manda sobre las sugerencias: se escribe un título y sale, cuadre
// o no cuadre, esté analizado o no. Una lista cerrada sin criterio no sirve.
await evaluar(`(() => {
  const campo = document.querySelector('[data-buscar-candidato]');
  campo.value = 'Lento';
  campo.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(600);
const buscados = await evaluar(`[...document.querySelectorAll('.candidato')].map(c => c.textContent.replace(/\\s+/g, ' ').trim())`);
comprobar('el buscador encuentra cualquier canción de la biblioteca',
  buscados.length === 1 && buscados[0].includes('Lento'), buscados.join(' | ') || 'nada');
comprobar('y el campo no pierde el foco al escribir',
  (await evaluar(`document.activeElement?.dataset?.buscarCandidato !== undefined`)) === true);

// Y se puede soltar en el plato B arrastrándola.
const soltada = await evaluar(`(async () => {
  const s = await window.pletina.library.snapshot();
  const track = s.tracks.find(x => x.title === 'Lento');
  const zona = document.querySelector('[data-suelta="b"]');
  const datos = new DataTransfer();
  datos.setData('application/x-pletina-tracks', JSON.stringify([track.id]));
  zona.dispatchEvent(new DragEvent('dragover', { dataTransfer: datos, bubbles: true, cancelable: true }));
  const encima = zona.classList.contains('encima');
  zona.dispatchEvent(new DragEvent('drop', { dataTransfer: datos, bubbles: true, cancelable: true }));
  return { encima, id: track.id };
})()`);
await sleep(1200);
const enPlato = await evaluar(`(async () => (await import('./mezclador.js')).platoB()?.id ?? null)()`);
comprobar('el plato B se enciende cuando le pasas una canción por encima', soltada.encima === true);
comprobar('y al soltarla se prepara ahí', enPlato === soltada.id, `${enPlato}`);

// La cola también es fuente de arrastre: en la cabina no se ve la biblioteca.
const abrirCola = async (abierta) => evaluar(`(async () => {
  const st = await import('./state.js');
  st.state.queueOpen = ${abierta};
  (await import('./ui/queue.js')).renderQueue();
  return st.state.queueOpen;
})()`);
await abrirCola(true);
await sleep(500);
const desdeLaCola = await evaluar(`(() => {
  const item = document.querySelector('#queue-panel .q-item[data-id]');
  if (!item) return 'sin cola abierta';
  const datos = new DataTransfer();
  item.dispatchEvent(new DragEvent('dragstart', { dataTransfer: datos, bubbles: true, cancelable: true }));
  return datos.getData('application/x-pletina-tracks');
})()`);
comprobar('una canción de la cola se puede arrastrar',
  typeof desdeLaCola === 'string' && desdeLaCola.startsWith('['), desdeLaCola);
// Y se deja como estaba, que lo que viene después mira la cola.
await abrirCola(false);

/* ------------------------------------------------- poner la rejilla a mano */

console.log('poner la rejilla a mano:');
// El «uno» tiene que quedar EXACTAMENTE donde está el plato. Guardar solo el
// desfase dentro de un tiempo lo dejaba a uno, dos o tres tiempos de donde se
// había puesto, tres veces de cada cuatro.
const puntos = [0.9, 1.4, 1.85, 2.3];
const errores = [];
for (const segundo of puntos) {
  await evaluar(`(async () => {
    const m = await import('./mezclador.js');
    const p = await import('./player.js');
    p.moverPreparado(${segundo});
    await m.ponerElUnoEnB();
  })()`);
  await sleep(500);
  const error = await evaluar(`(async () => {
    const m = await import('./mezclador.js');
    const r = m.platoB()?.ficha?.rejilla;
    if (!r?.bpm) return null;
    const periodo = 60 / r.bpm;
    const compas = periodo * (r.tiemposPorCompas ?? 4);
    const uno = r.offset + (r.tiempoFuerte ?? 0) * periodo;
    const resto = ((${segundo} - uno) % compas + compas) % compas;
    return Math.min(resto, compas - resto);
  })()`);
  errores.push(error);
}
comprobar('«El uno está aquí» deja el uno donde se ha puesto',
  errores.every((e) => e !== null && e < 0.02),
  errores.map((e) => (e === null ? '—' : `${Math.round(e * 1000)} ms`)).join(' · '));

// Y marcar el tempo a mano: cuatro golpecitos y la canción tiene tempo, acierte
// o no el análisis.
const antesDeMarcar = await evaluar(`(async () => (await import('./mezclador.js')).platoB()?.ficha?.bpm ?? 0)()`);
// Pulsando el botón como se pulsa, seis veces a medio segundo: 120.
for (let i = 0; i < 6; i += 1) {
  await evaluar(`document.querySelector('[data-marcar="b"]')?.click()`);
  await sleep(500);
}
await sleep(400);
const marcado = {
  antes: antesDeMarcar,
  despues: await evaluar(`(async () => (await import('./mezclador.js')).platoB()?.ficha?.bpm ?? 0)()`),
  ultimo: { golpes: 6 },
};
comprobar('marcar el tempo a mano se lo pone a la canción',
  Math.abs(marcado.despues - 120) < 6,
  `${marcado.antes} → ${marcado.despues} bpm con ${marcado.ultimo?.golpes} golpes`);
comprobar('y la rejilla queda puesta a mano', (await evaluar(`(async () => {
  const m = await import('./mezclador.js');
  return m.platoB()?.ficha?.rejilla?.aMano === true;
})()`)) === true);

/* ------------------------------------------------------- la tira de canal */

console.log('la tira de canal:');
const medirTira = () => evaluar(`(async () => {
  const p = await import('./player.js');
  const platos = p.estadoDePlatos();
  const motor = p.engine();
  return { tira: p.estadoTira('a'), platos: platos.length, hayMotor: Boolean(motor) };
})()`);

const antesDeTocar = await medirTira();
comprobar('el plato que suena tiene su tira', antesDeTocar.hayMotor === true,
  JSON.stringify(antesDeTocar.tira));

// Se mueven los mandos como se mueven: arrastrando, que emite `input`.
const mover = async (mando, valor) => {
  await evaluar(`(() => {
    const m = document.querySelector('[data-tira="a"][data-mando="${mando}"]');
    if (!m) return false;
    m.value = '${valor}';
    m.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(250);
};

await mover('grave', -26);
await mover('filtro', 0.6);
await mover('volumen', 0.5);
const tocada = (await medirTira()).tira;
comprobar('los mandos llegan al motor de audio',
  tocada.grave === -26 && Math.abs(tocada.filtro - 0.6) < 0.01 && Math.abs(tocada.volumen - 0.5) < 0.01,
  JSON.stringify(tocada));

// Y el grafo lo ha aplicado de verdad, no solo la contabilidad.
const enElGrafo = await evaluar(`(async () => {
  const p = await import('./player.js');
  const nodos = p.nodosDePlato?.('a');
  if (!nodos) return null;
  return {
    grave: Math.round(nodos.mGrave.gain.value * 10) / 10,
    filtro: nodos.filtro.type,
    corte: Math.round(nodos.filtro.frequency.value),
    trim: Math.round(nodos.trim.gain.value * 100) / 100,
  };
})()`);
comprobar('y el grafo de audio los aplica', enElGrafo
  && enElGrafo.grave < -20 && enElGrafo.filtro === 'highpass' && enElGrafo.trim < 0.6,
  JSON.stringify(enElGrafo));

// Doble clic devuelve la banda a su sitio.
await evaluar(`(() => {
  const m = document.querySelector('[data-tira="a"][data-mando="grave"]');
  m.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
  return true;
})()`);
await sleep(300);
comprobar('doble clic devuelve la banda', (await medirTira()).tira.grave === 0,
  JSON.stringify((await medirTira()).tira.grave));
await mover('filtro', 0);
await mover('volumen', 1);

/* -------------------------------------------------------- los interruptores */

// Las tres casillas de la cabina: igualar el tempo, mantener el tono y
// encadenar sola. Se pulsan como se pulsan —un clic en la casilla— y se mira el
// estado del mezclador, que es quien manda cuando llega la mezcla.
console.log('los interruptores:');
const ajustes = () => evaluar(`(async () => (await import('./state.js')).state.mezclador)()`);
const pulsarCasilla = async (cual) => {
  await evaluar(`(() => {
    const c = document.querySelector('[data-mezcla="${cual}"]');
    if (!c) return false;
    c.click();
    return true;
  })()`);
  await sleep(350);
};

for (const cual of ['ajustarTempo', 'estirarTiempo', 'auto']) {
  const antes = (await ajustes())[cual];
  await pulsarCasilla(cual);
  const despues = (await ajustes())[cual];
  comprobar(`«${cual}» cambia al pulsarla`, despues !== antes, `${antes} → ${despues}`);
  await pulsarCasilla(cual);
  const vuelta = (await ajustes())[cual];
  comprobar(`y vuelve a su sitio`, vuelta === antes, `${despues} → ${vuelta}`);
  // Y la casilla de la pantalla dice lo mismo que el estado: si no, se ve
  // apagada mientras el mezclador la da por encendida.
  const pintada = await evaluar(`document.querySelector('[data-mezcla="${cual}"]').checked`);
  comprobar('y la pantalla dice lo mismo que el mezclador', pintada === vuelta,
    `pantalla ${pintada}, mezclador ${vuelta}`);
}

/* ------------------------------------------------------------- las teclas */

console.log('las teclas:');
const pulsar = async (key, mods = {}) => {
  await evaluar(`(() => {
    // Al elemento que tiene el foco, que es a donde el navegador manda una
    // tecla de verdad. Mandarla al documento sería probar otra cosa.
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', {
      key: ${JSON.stringify(key)}, ctrlKey: ${Boolean(mods.ctrl)}, altKey: ${Boolean(mods.alt)},
      bubbles: true, cancelable: true,
    }));
    return true;
  })()`);
  await sleep(320);
};

const vista = () => evaluar(`(async () => (await import('./state.js')).state.view.type)()`);

await pulsar('2', { ctrl: true });
comprobar('Ctrl+2 lleva a los álbumes', (await vista()) === 'albums', await vista());
await pulsar('4', { ctrl: true });
comprobar('Ctrl+4 lleva a los favoritos', (await vista()) === 'favorites', await vista());
await pulsar('6', { ctrl: true });
comprobar('Ctrl+6 lleva al mezclador', (await vista()) === 'mezclador', await vista());

await pulsar('f', { ctrl: true });
comprobar('Ctrl+F pone el cursor en la búsqueda',
  (await evaluar(`document.activeElement?.id`)) === 'q');
await evaluar(`document.activeElement.blur()`);

const silencio = () => evaluar(`(async () => (await import('./state.js')).state.muted)()`);
await pulsar('m', { ctrl: true });
comprobar('Ctrl+M silencia', (await silencio()) === true);
await pulsar('m', { ctrl: true });
comprobar('y vuelve a sonar', (await silencio()) === false);

const cola = () => evaluar(`(async () => (await import('./state.js')).state.queueOpen)()`);
await pulsar('u', { ctrl: true });
comprobar('Ctrl+U abre la cola', (await cola()) === true);
await pulsar('u', { ctrl: true });
comprobar('y la cierra', (await cola()) === false);

const aleatorio = () => evaluar(`(async () => (await import('./state.js')).state.shuffle)()`);
const antes = await aleatorio();
await pulsar('s', { ctrl: true });
comprobar('Ctrl+S cambia el orden aleatorio', (await aleatorio()) !== antes);

// Y las de siempre: las que se pulsan sin nada más.
const tiempo = () => evaluar(`(async () => (await import('./player.js')).currentTime())()`);
const sonando = () => evaluar(`(async () => (await import('./state.js')).state.playing)()`);
await pulsar(' ');
comprobar('el espacio para y arranca', (await sonando()) === false);
await pulsar(' ');
comprobar('y vuelve a arrancar', (await sonando()) === true);

// Un mando con el foco no puede secuestrar el teclado entero: mueves el
// volumen con el ratón y a partir de ahí no responde ni el espacio.
await evaluar(`(() => {
  const mando = document.querySelector('input[type="range"]');
  mando.focus();
  return mando.id || mando.className;
})()`);
await pulsar('u', { ctrl: true });
comprobar('con el foco en un deslizador, los atajos siguen llegando', (await cola()) === true);
await pulsar('u', { ctrl: true });
// Pero sus flechas siguen siendo suyas: para eso está.
const posicion = () => evaluar(`document.querySelector('input[type="range"]').value`);
const valorAntes = await posicion();
const flecha = await evaluar(`(() => {
  const mando = document.querySelector('input[type="range"]');
  mando.focus();
  const evento = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
  mando.dispatchEvent(evento);
  return evento.defaultPrevented;
})()`);
comprobar('y sus flechas siguen siendo suyas', flecha === false && (await posicion()) === valorAntes,
  flecha ? 'la aplicación se las queda' : `llegan al deslizador (${valorAntes})`);
await evaluar(`document.activeElement.blur()`);

// Una casilla con el foco se queda con su espacio: marcarla es lo único que se
// puede hacer sin ratón, y perderlo para ganar un atajo sería mal negocio. Aquí
// se mira que la aplicación no lo intercepte —una tecla fabricada no dispara el
// comportamiento del navegador, así que marcarla de verdad no se puede probar
// desde aquí, pero estorbarla sí—, y de paso que no le pase la música.
const antesDeLaCasilla = await sonando();
const casilla = await evaluar(`(() => {
  const c = document.querySelector('input[type="checkbox"]');
  if (!c) return null;
  c.focus();
  const evento = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  c.dispatchEvent(evento);
  return { interceptada: evento.defaultPrevented };
})()`);
await sleep(320);
comprobar('el espacio de una casilla con el foco es suyo, no de la música',
  casilla?.interceptada === false && (await sonando()) === antesDeLaCasilla,
  casilla?.interceptada ? 'la aplicación se lo queda' : 'llega a la casilla');
await evaluar(`document.activeElement.blur()`);

// Y un botón pulsado con el ratón devuelve el teclado a la aplicación.
await evaluar(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => !x.disabled);
  b.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  return true;
})()`);
comprobar('un botón pulsado con el ratón suelta el foco',
  (await evaluar(`document.activeElement?.tagName`)) !== 'BUTTON');

// Y las de la cabina, que es donde no se puede estar con el ratón.
await pulsar('6', { ctrl: true });
await evaluar(`(async () => {
  const m = await import('./mezclador.js');
  const s = await window.pletina.library.snapshot();
  await m.cargarEnPlatoB(s.tracks.find(x => x.title === 'Lento').id);
})()`);
await sleep(900);
const enB = () => evaluar(`(async () => (await import('./mezclador.js')).platoB()?.tiempo ?? -1)()`);
const antesDelSalto = await enB();
await pulsar(']');
const trasElSalto = await enB();
comprobar('«]» adelanta un compás en el plato B', trasElSalto > antesDelSalto,
  `${antesDelSalto.toFixed(2)} s → ${trasElSalto.toFixed(2)} s`);
await pulsar('[');
comprobar('y «[» lo devuelve', Math.abs((await enB()) - antesDelSalto) < 0.01);

const escuchando = () => evaluar(`(async () => (await import('./mezclador.js')).platoB()?.escuchando)()`);
await pulsar('b');
comprobar('«B» preescucha el plato preparado', (await escuchando()) === true);
await pulsar('b');
comprobar('y lo deja de preescuchar', (await escuchando()) === false);

// Con la canción colocada lejos del final: las de la prueba duran treinta
// segundos y a estas alturas se habría acabado sola.
await evaluar(`(async () => {
  const p = await import('./player.js');
  p.seekTo(4);
  return p.currentTime();
})()`);
await sleep(300);
const donde = await tiempo();
await pulsar('ArrowRight');
comprobar('la flecha adelanta cinco segundos', (await tiempo()) - donde > 3,
  `${donde.toFixed(1)} s → ${(await tiempo()).toFixed(1)} s`);
const despues = await tiempo();
await pulsar('ArrowRight', { alt: true });
comprobar('y con Alt, diez', (await tiempo()) - despues > 7,
  `${despues.toFixed(1)} s → ${(await tiempo()).toFixed(1)} s`);

console.log('la herramienta de analizar:');
// Analizar tiene que poder pedirse SIEMPRE, también cuando ya está hecho: es
// el botón al que se recurre justo cuando algo no cuadra. La versión anterior
// lo escondía en cuanto la canción contaba como analizada, y quien quería
// rehacerla se quedaba mirando una cabina sin ninguna herramienta.
const botonesDeAnalizar = await evaluar(`(() => {
  // Lo que dice el botón: su etiqueta, la de accesibilidad o su título. Un
  // botón de solo icono sin ninguna de las tres no dice nada a nadie.
  const texto = (sel) => [...document.querySelectorAll(sel)].map(b => (
    b.textContent.replace(/\\s+/g, ' ').trim() || b.getAttribute('aria-label') || b.title || ''
  ));
  return {
    platos: texto('[data-mezcla="analizar"]'),
    lote: texto('[data-mezcla="analizar-pendientes"]'),
  };
})()`);
comprobar('el plato ofrece volver a analizar aunque ya esté analizada',
  botonesDeAnalizar.platos.length >= 1 && botonesDeAnalizar.platos.every((t) => /analizar/i.test(t)),
  botonesDeAnalizar.platos.join(' · ') || 'ninguno');
comprobar('y la cabina también, con todo analizado',
  botonesDeAnalizar.lote.length === 1 && /analizar/i.test(botonesDeAnalizar.lote[0]),
  botonesDeAnalizar.lote.join(' · ') || 'ninguno');

// Y al pulsarlo con todo analizado, rehace de verdad en vez de contestar que
// ya estaba hecho.
const antesDeRehacer = await evaluar(`(async () => {
  const s = await window.pletina.library.snapshot();
  return s.tracks.find(t => t.title === 'Garage')?.analisis?.en ?? 0;
})()`);
await evaluar(`document.querySelector('[data-mezcla="analizar"]')?.click()`);
for (let i = 0; i < 400; i += 1) {
  await sleep(100);
  if (i > 12 && !(await evaluar(`document.querySelector('#chip')?.classList.contains('show') ?? false`))) break;
}
await sleep(800);
const despuesDeRehacer = await evaluar(`(async () => {
  const s = await window.pletina.library.snapshot();
  return s.tracks.find(t => t.title === 'Garage')?.analisis?.en ?? 0;
})()`);
comprobar('volver a analizar rehace el trabajo, no contesta que ya estaba',
  despuesDeRehacer > antesDeRehacer, `${antesDeRehacer} → ${despuesDeRehacer}`);


clearTimeout(guardia);
await terminar(fallos.length ? 1 : 0, fallos.length
  ? `REJILLA: fallan ${fallos.length} — ${fallos.join(' · ')}`
  : 'REJILLA: correcto · octava, ondas y teclas');
