import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

/**
 * Una sesión entera, de extremo a extremo.
 *
 * La prueba de la mezcla mira una transición con lupa. Esta mira lo otro: tres
 * canciones seguidas, encadenadas solas, que es como se usa el mezclador de
 * verdad. Aquí es donde salieron dos errores que una sola transición no enseña:
 * la mezcla automática se quedaba en un compás —el aviso de «se acerca el
 * final» se calculaba con la duración ya recortada— y el tempo ajustado de una
 * mezcla no se propagaba a la siguiente, así que la tercera canción entraba
 * desincronizada.
 *
 * Se comprueba que las dos transiciones ocurren solas, que no hay un solo
 * silencio en toda la cadena y que los compases de las dos canciones que suenan
 * a la vez se mantienen juntos en las dos.
 */
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUERTO = 9458;
const TASA = 22050;

/**
 * Una canción de bombo: un pulso grave que decae en cada tiempo, con un siseo
 * corto entre medias. Es lo mínimo para que el analizador tenga algo que medir.
 */
function wavConBombo({ bpm, offset, silencio = 0, segundos = 26 }) {
  const total = Math.floor(TASA * segundos);
  const datos = Buffer.alloc(total * 2);
  const periodo = 60 / bpm;
  const muestras = new Float32Array(total);

  for (let golpe = 0; ; golpe += 1) {
    const en = silencio + offset + golpe * periodo;
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
const perfil = await mkdtemp(path.join(tmpdir(), 'pletina-cadena-'));
const musica = path.join(perfil, 'musica');
await rm(musica, { recursive: true, force: true });
await (await import('node:fs/promises')).mkdir(musica, { recursive: true });
const PISTAS = [
  { titulo: 'Uno', bpm: 128, offset: 0.1, segundos: 46 },
  { titulo: 'Dos', bpm: 126, offset: 0.25, segundos: 46 },
  { titulo: 'Tres', bpm: 129, offset: 0.4, segundos: 46 },
];
for (const pista of PISTAS) {
  await writeFile(path.join(musica, `Sala Uno - ${pista.titulo}.wav`), wavConBombo(pista));
}
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

/* ---------------------------------------- una cadena de mezclas automáticas */

console.log('cadena automática:');
await evaluar(`document.querySelector('[data-tool="analizar"]').click()`);
let visto = false;
for (let i = 0; i < 1200; i += 1) {
  await sleep(100);
  const aviso = await evaluar(`document.querySelector('#chip')?.classList.contains('show') || false`);
  if (aviso) visto = true;
  else if (visto) break;
}
const fichas = await evaluar(`(async () => {
  const s = await window.pletina.library.snapshot();
  return s.tracks.map(t => ({ id: t.id, titulo: t.title, bpm: t.bpm, rejilla: t.rejilla }));
})()`);
comprobar('las tres analizadas', fichas.every(f => f.bpm > 0 && f.rejilla),
  fichas.map(f => `${f.titulo} ${f.bpm?.toFixed(2)}`).join(' · '));

// Se ponen las tres en la cola y se enciende la mezcla automática.
const orden = ['Uno', 'Dos', 'Tres'].map(t => fichas.find(f => f.titulo === t));
await evaluar(`(async () => {
  const q = await import('./shared/queue.js');
  const st = await import('./state.js');
  const ids = ${JSON.stringify(orden.map(o => o.id))};
  const fila = [...document.querySelectorAll('.row')].find(f => f.dataset.id === ids[0]);
  fila.querySelector('.idx').click();
  st.state.queue = q.enqueueNext(st.state.queue, ids.slice(1));
})()`);
await sleep(1200);

// Los ajustes, desde la pantalla del mezclador: transiciones cortas y encadenar
// sola. Es la misma casilla que pulsa una persona.
await evaluar(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('Mezclador')).click()`);
await sleep(700);
await evaluar(`document.querySelector('[data-mezcla="compases"][data-valor="4"]').click()`);
await sleep(300);
await evaluar(`(() => {
  const c = document.querySelector('[data-mezcla="auto"]');
  c.checked = true;
  c.dispatchEvent(new Event('change', { bubbles: true }));
  c.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(400);
const ajustes = await evaluar(`(async () => (await import('./mezclador.js')).estadoDeMezcla().ajustes)()`);
comprobar('la casilla enciende la mezcla automática', ajustes.auto === true && ajustes.compases === 4,
  JSON.stringify(ajustes));

// Grabador fino durante toda la cadena.
await evaluar(`(async () => {
  const p = await import('./player.js');
  window.__reg = [];
  window.__cero = performance.now();
  window.__timer = setInterval(() => {
    window.__reg.push({
      w: (performance.now() - window.__cero) / 1000,
      platos: p.estadoDePlatos().filter(x => x.id).map(x => ({ id: x.id, t: x.tiempo, v: x.velocidad, g: x.ganancia, s: x.sonando })),
    });
  }, 40);
})()`);

// Se salta al final de la primera para no esperar cuarenta segundos, y luego
// se deja que la cadena corra sola.
await evaluar(`(async () => { const p = await import('./player.js'); p.seekTo(p.duration() - 14); })()`);
await sleep(20000);
await evaluar(`(async () => { const p = await import('./player.js'); p.seekTo(p.duration() - 14); })()`);
await sleep(22000);

const cadena = await evaluar(`(async () => {
  clearInterval(window.__timer);
  const reg = window.__reg;
  const rejillas = ${JSON.stringify(Object.fromEntries(orden.map(o => [o.id, o.rejilla])))};
  const fase = (t, r) => {
    const compas = (60 / r.bpm) * (r.tiemposPorCompas || 4);
    const uno = r.offset + (r.tiempoFuerte || 0) * (60 / r.bpm);
    return ((((t - uno) % compas) + compas) % compas) / compas;
  };
  // Tramos donde suenan dos platos a la vez con volumen: cada uno es una mezcla.
  const transiciones = [];
  let actual = null;
  for (const m of reg) {
    const suenan = m.platos.filter(x => x.s && x.g > 0.05);
    if (suenan.length === 2) {
      if (!actual) actual = { desde: m.w, desfases: [], ids: suenan.map(x => x.id) };
      const [a, b] = suenan;
      if (rejillas[a.id] && rejillas[b.id]) {
        const d = Math.abs(fase(a.t, rejillas[a.id]) - fase(b.t, rejillas[b.id]));
        actual.desfases.push(Math.min(d, 1 - d));
      }
    } else if (actual) {
      actual.hasta = m.w;
      if (actual.desfases.length > 5) transiciones.push(actual);
      actual = null;
    }
  }
  const mudos = reg.filter(m => m.platos.length && m.platos.every(x => !x.s || x.g < 0.02)).length;
  return {
    muestras: reg.length,
    mudos,
    transiciones: transiciones.map(t => {
      const orden = [...t.desfases].sort((x, y) => x - y);
      return {
        dura: Math.round((t.hasta - t.desde) * 10) / 10,
        mediano: orden[Math.floor(orden.length / 2)],
        peor: orden[orden.length - 1],
        medidas: orden.length,
      };
    }),
  };
})()`);
console.log('   transiciones:', JSON.stringify(cadena.transiciones));
comprobar('encadena las tres canciones sola', cadena.transiciones.length >= 2,
  `${cadena.transiciones.length} transiciones`);
comprobar('sin un solo silencio en toda la cadena', cadena.mudos === 0, `${cadena.mudos} muestras mudas`);
for (const [i, t] of cadena.transiciones.entries()) {
  comprobar(`la transición ${i + 1} va cuadrada`, t.mediano < 0.02,
    `${(t.mediano * 100).toFixed(2)} % de compás (peor ${(t.peor * 100).toFixed(2)} %) en ${t.medidas} medidas`);
}

clearTimeout(guardia);
ws.close();
if (fallos.length) await terminar(1, `CADENA: ${fallos.length} fallo(s): ${fallos.join(', ')}`);
await terminar(0, 'CADENA: correcto');
