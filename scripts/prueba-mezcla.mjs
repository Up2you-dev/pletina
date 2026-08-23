import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

/**
 * Prueba del mezclador, de extremo a extremo.
 *
 * Existe por un error que no se ve en ninguna prueba unitaria: el plan de
 * mezcla calculaba bien el ajuste de tempo, pero el plato no lo aplicaba. La
 * causa era una línea en el orden equivocado —asignar `src` reinicia el
 * elemento y con él `playbackRate`—, así que el plan decía «+1,6 %» y la
 * canción entraba a su velocidad, desincronizada. Aquí se fabrica un par de
 * canciones con bombo a 128 y 126, se analizan con el analizador de verdad y se
 * mira lo que hace el grafo de audio durante la transición.
 *
 * Lo que se comprueba: que el pinchazo cae en un inicio de compás, que la que
 * entra empieza en el suyo, que va a la velocidad del plan sin cambiar de tono,
 * que entra sin graves y que el cambio de graves ocurre.
 */
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUERTO = 9456;
const TASA = 22050;

/**
 * Una canción de bombo: un pulso grave que decae en cada tiempo, con un siseo
 * corto entre medias. Es lo mínimo para que el analizador tenga algo que medir.
 */
function wavConBombo({ bpm, offset, segundos = 26 }) {
  const total = Math.floor(TASA * segundos);
  const datos = Buffer.alloc(total * 2);
  const periodo = 60 / bpm;
  const muestras = new Float32Array(total);

  for (let golpe = 0; ; golpe += 1) {
    const en = offset + golpe * periodo;
    if (en >= segundos) break;
    const desde = Math.floor(en * TASA);
    // Bombo: seno de 60 Hz con caída exponencial rápida.
    for (let i = 0; i < TASA * 0.18 && desde + i < total; i += 1) {
      const t = i / TASA;
      muestras[desde + i] += Math.sin(2 * Math.PI * 60 * t) * Math.exp(-t * 22) * 0.9;
    }
    // Y un siseo en la contra, para que la envolvente no sea solo grave.
    const contra = Math.floor((en + periodo / 2) * TASA);
    for (let i = 0; i < TASA * 0.04 && contra + i < total; i += 1) {
      const t = i / TASA;
      muestras[contra + i] += (Math.sin(i * 12.9898) * 43758.5453 % 1) * Math.exp(-t * 90) * 0.25;
    }
  }
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
const perfil = await mkdtemp(path.join(tmpdir(), 'pletina-mezcla-'));
const musica = path.join(perfil, 'musica');
await rm(musica, { recursive: true, force: true });
await (await import('node:fs/promises')).mkdir(musica, { recursive: true });
const SALIENTE = { bpm: 128, offset: 0.1 };
const ENTRANTE = { bpm: 126, offset: 0.25 };
await writeFile(path.join(musica, 'Sala Uno - Sale.wav'), wavConBombo(SALIENTE));
await writeFile(path.join(musica, 'Sala Uno - Entra.wav'), wavConBombo(ENTRANTE));
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

const guardia = setTimeout(() => terminar(1, 'MEZCLA: la aplicación no ha respondido a tiempo'), 180000);

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

// La que sale suena; la que entra espera en la cola.
const puestas = await evaluar(`(async () => {
  const s = await window.pletina.library.snapshot();
  const sale = s.tracks.find(t => t.title === 'Sale');
  const entra = s.tracks.find(t => t.title === 'Entra');
  if (!sale || !entra) return null;
  const q = await import('./shared/queue.js');
  const st = await import('./state.js');
  const fila = [...document.querySelectorAll('.row')].find(f => f.dataset.id === sale.id);
  fila.querySelector('.idx').click();
  st.state.queue = q.enqueueNext(st.state.queue, [entra.id]);
  return { sale: sale.id, entra: entra.id };
})()`);
if (!puestas) await terminar(1, 'MEZCLA: la biblioteca no ha leído las dos canciones');
await sleep(1500);

// Al mezclador, y a analizar desde su propia pantalla.
await evaluar(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('Mezclador')).click()`);
await sleep(600);
for (let vuelta = 0; vuelta < 2; vuelta += 1) {
  const queda = await evaluar(`(() => {
    const b = document.querySelector('[data-mezcla="analizar"]');
    if (b) b.click();
    return Boolean(b);
  })()`);
  if (!queda) break;
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    if (!await evaluar(`document.querySelector('#chip')?.classList.contains('show')`)) break;
  }
  await sleep(500);
}

const compasDe = (bpm) => (4 * 60) / bpm;
const fichas = await evaluar(`(async () => {
  const m = await import('./mezclador.js');
  const p = m.prepararPlan();
  return p && { saliente: p.saliente, entrante: p.entrante, resumen: p.resumen,
    velocidad: p.plan.velocidad, avisos: p.plan.avisos };
})()`);
if (!fichas) await terminar(1, 'MEZCLA: el mezclador no ha podido preparar el plan');

const compas = compasDe(fichas?.saliente?.bpm || 128);
console.log('análisis:');
comprobar('el tempo de la que sale se detecta', Math.abs(fichas.saliente.bpm - SALIENTE.bpm) <= 1.5,
  `${fichas.saliente.bpm?.toFixed(1)} bpm (se fabricó a ${SALIENTE.bpm})`);
comprobar('el tempo de la que entra se detecta', Math.abs(fichas.entrante.bpm - ENTRANTE.bpm) <= 1.5,
  `${fichas.entrante.bpm?.toFixed(1)} bpm (se fabricó a ${ENTRANTE.bpm})`);
comprobar('la rejilla encuentra el bombo', fichas.saliente.rejilla?.porBombo === true,
  `desfase ${fichas.saliente.rejilla?.offset?.toFixed(3)} s (se fabricó en ${SALIENTE.offset})`);
comprobar('y el plan ajusta el tempo', fichas.velocidad > 1 && fichas.velocidad < 1.05, fichas.resumen);

// Grabador fino: 30 ms de resolución sobre el estado real de los dos platos.
// Los dos se leen en la misma llamada, así que sus tiempos son comparables
// entre sí sin arrastrar la latencia de la tarjeta de sonido.
await evaluar(`(async () => {
  const p = await import('./player.js');
  window.__reg = [];
  window.__cero = performance.now();
  window.__timer = setInterval(() => {
    window.__reg.push({
      w: (performance.now() - window.__cero) / 1000,
      platos: p.estadoDePlatos().map(x => ({
        id: x.id, t: x.tiempo, v: x.velocidad, e: x.estirando, g: x.ganancia, b: x.grave, s: x.sonando,
      })),
    });
  }, 30);
})()`);

await evaluar(`document.querySelector('[data-mezcla="ahora"]').click()`);
const plan = await evaluar(`(async () => {
  const m = await import('./mezclador.js');
  const { enCurso } = m.estadoDeMezcla();
  return enCurso && { arranque: enCurso.plan.arranque, espera: enCurso.espera, velocidad: enCurso.plan.velocidad,
    inicioEntrante: enCurso.plan.inicioEntrante, duracion: enCurso.plan.duracion, cambio: enCurso.plan.cambioDeGraves };
})()`);
if (!plan) await terminar(1, 'MEZCLA: la mezcla no ha arrancado');

await sleep((plan.espera + plan.duracion + 2) * 1000);
const medido = await evaluar(`(async () => {
  clearInterval(window.__timer);
  const reg = window.__reg;
  const sale = ${JSON.stringify(puestas.sale)}, entra = ${JSON.stringify(puestas.entra)};
  const rejillas = ${JSON.stringify({ sale: fichas.saliente.rejilla, entra: fichas.entrante.rejilla })};
  const de = (m, id) => m.platos.find(x => x.id === id);

  const primeraAudible = reg.find(m => (de(m, entra)?.g ?? 0) > 0.01);
  const primeraSonando = reg.find(m => de(m, entra)?.s);
  const cambio = reg.find(m => (de(m, sale)?.b ?? 0) < -20 && (de(m, entra)?.b ?? -30) > -1);
  const juntos = reg.filter(m => de(m, sale)?.s && de(m, entra)?.s);
  const desde = reg.indexOf(primeraAudible);
  const mudos = reg.slice(desde, desde + 400).filter(m => m.platos.every(x => !x.s || x.g < 0.02)).length;

  // Fase dentro del compás de cada canción, medida sobre SU propia rejilla.
  // Si los unos coinciden, las dos fracciones van juntas toda la transición;
  // si el ajuste de tempo no llega al plato, se separan poco a poco.
  const compasDe = (r) => (4 * 60) / r.bpm;
  // El uno de cada canción es su desfase más el tiempo fuerte que detectó el
  // analizador: comparar sin él daría un compás desplazado un tiempo.
  const fase = (t, r) => {
    const c = compasDe(r);
    const uno = r.offset + (r.tiempoFuerte || 0) * (60 / r.bpm);
    return ((((t - uno) % c) + c) % c) / c;
  };
  const distancias = juntos
    .filter(m => de(m, entra).g > 0.05)
    .map(m => {
      const d = Math.abs(fase(de(m, sale).t, rejillas.sale) - fase(de(m, entra).t, rejillas.entra));
      return Math.min(d, 1 - d);
    })
    .sort((a, b) => a - b);

  return {
    esperaMedida: primeraAudible ? primeraAudible.w : null,
    arranqueDelPlato: primeraSonando ? primeraSonando.w : null,
    velocidad: Math.max(...reg.map(m => de(m, entra)?.v ?? 0)),
    estirando: primeraAudible ? de(primeraAudible, entra).e : null,
    graveAlEntrar: primeraAudible ? de(primeraAudible, entra).b : null,
    huboCambio: Boolean(cambio),
    juntos: juntos.length,
    mudos,
    desfaseMediano: distancias.length ? distancias[Math.floor(distancias.length / 2)] : null,
    desfaseMaximo: distancias.length ? distancias[distancias.length - 1] : null,
    muestrasDeFase: distancias.length,
  };
})()`);

console.log('transición:');
comprobar('la transición espera al siguiente compás', plan.espera > 0.25,
  `${plan.espera.toFixed(2)} s de espera, con compases de ${compas.toFixed(3)} s`);
comprobar('y no se oye ni una nota antes de tiempo',
  Math.abs(medido.esperaMedida - plan.espera) < 0.4,
  `se empieza a oír a los ${medido.esperaMedida?.toFixed(2)} s`);
comprobar('los compases de las dos van juntos', medido.desfaseMediano < 0.08,
  `${(medido.desfaseMediano * 100).toFixed(1)} % de compás de desfase mediano en ${medido.muestrasDeFase} medidas`);
comprobar('sin separarse en toda la transición', medido.desfaseMaximo < 0.16,
  `${(medido.desfaseMaximo * 100).toFixed(1)} % en el peor momento`);
comprobar('el plato va a la velocidad del plan', Math.abs(medido.velocidad - plan.velocidad) < 0.001,
  `×${medido.velocidad} (plan ×${plan.velocidad})`);
comprobar('sin cambiar el tono', medido.estirando === true);
comprobar('la que entra lo hace sin graves', medido.graveAlEntrar <= -20, `${medido.graveAlEntrar} dB`);
comprobar('el cambio de graves ocurre', medido.huboCambio);
comprobar('los dos platos suenan a la vez', medido.juntos > 20, `${medido.juntos} muestras`);
comprobar('y no hay un solo silencio', medido.mudos === 0, `${medido.mudos}`);

clearTimeout(guardia);
ws.close();
if (fallos.length) await terminar(1, `MEZCLA: ${fallos.length} comprobación(es) fallida(s): ${fallos.join(', ')}`);
await terminar(0, `MEZCLA: correcto · ${fichas.resumen}`);
