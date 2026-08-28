/** ¿Se dibuja la rejilla encima de la onda? Se mira el lienzo, no el código. */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';

const raiz = '/home/user/pletina';
const PUERTO = 9473;
const TASA = 22050;
function wav({ bpm, offset = 0.1, segundos = 45 }) {
  const total = Math.floor(TASA * segundos);
  const m = new Float32Array(total);
  const periodo = 60 / bpm;
  for (let g = 0; ; g += 1) {
    const en = offset + g * periodo;
    if (en >= segundos) break;
    const d = Math.floor(en * TASA);
    for (let i = 0; i < TASA * 0.18 && d + i < total; i += 1) {
      const t = i / TASA;
      m[d + i] += Math.sin(2 * Math.PI * 60 * t) * Math.exp(-t * 22) * 0.9;
    }
    if (g % 2 === 1) for (let i = 0; i < TASA * 0.14 && d + i < total; i += 1) {
      const t = i / TASA;
      m[d + i] += ((Math.sin(i * 12.9) * 43758.5) % 1) * 0.6 * Math.exp(-t * 22);
    }
  }
  const datos = Buffer.alloc(total * 2);
  for (let i = 0; i < total; i += 1) datos.writeInt16LE(Math.round(Math.max(-1, Math.min(1, m[i])) * 32000), i * 2);
  const c = Buffer.alloc(44);
  c.write('RIFF', 0, 4, 'ascii'); c.writeUInt32LE(36 + datos.length, 4);
  c.write('WAVEfmt ', 8, 8, 'ascii'); c.writeUInt32LE(16, 16); c.writeUInt16LE(1, 20);
  c.writeUInt16LE(1, 22); c.writeUInt32LE(TASA, 24); c.writeUInt32LE(TASA * 2, 28);
  c.writeUInt16LE(2, 32); c.writeUInt16LE(16, 34); c.write('data', 36, 4, 'ascii');
  c.writeUInt32LE(datos.length, 40);
  return Buffer.concat([c, datos]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const perfil = await mkdtemp(path.join(tmpdir(), 'pletina-rej-'));
const musica = path.join(perfil, 'musica');
await mkdir(musica, { recursive: true });
await writeFile(path.join(musica, 'Sala - Una.wav'), wav({ bpm: 126 }));
await writeFile(path.join(musica, 'Sala - Dos.wav'), wav({ bpm: 124 }));
await writeFile(path.join(perfil, 'biblioteca.json'), JSON.stringify({
  version: 1, folders: [{ path: musica, addedAt: Date.now() }], tracks: {}, playlists: [],
}));
const hijo = spawn('xvfb-run', ['-a', electron, raiz, '--no-sandbox', `--user-data-dir=${perfil}`,
  `--remote-debugging-port=${PUERTO}`, '--remote-allow-origins=*'],
{ env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }, stdio: ['ignore', 'ignore', 'ignore'], detached: true });
const fin = async (c, m) => { console.log(m); try { process.kill(-hijo.pid, 'SIGKILL'); } catch { /* */ } await rm(perfil, { recursive: true, force: true }).catch(() => {}); process.exit(c); };
setTimeout(() => fin(1, 'sin respuesta'), 180000);
let pagina = null;
for (let i = 0; i < 60 && !pagina; i += 1) {
  try { pagina = (await (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json()).find((t) => t.type === 'page' && t.url.startsWith('pletina://')); } catch { /* */ }
  if (!pagina) await sleep(500);
}
const ws = new WebSocket(pagina.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const esperando = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && esperando.has(m.id)) { esperando.get(m.id)(m); esperando.delete(m.id); } };
const enviar = (method, params = {}) => new Promise((r) => { id += 1; esperando.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (x) => (await enviar('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }))?.result?.result?.value;

await sleep(5000);
await ev(`document.querySelector('[data-tool="analizar"]')?.click()`);
for (let i = 0; i < 900; i += 1) { await sleep(100); if (i > 25 && !(await ev(`document.querySelector('#chip')?.classList.contains('show') ?? false`))) break; }
await sleep(1200);

console.log('lo que ha guardado el análisis:');
console.log(JSON.stringify(await ev(`(async () => {
  const s = await window.pletina.library.snapshot();
  return s.tracks.map(t => ({ t: t.title, bpm: t.bpm, key: t.key, rejilla: t.rejilla && {
    bpm: t.rejilla.bpm, offset: t.rejilla.offset, fuerza: t.rejilla.fuerza, deriva: t.rejilla.deriva,
    version: t.rejilla.version, tiempoFuerte: t.rejilla.tiempoFuerte, fuerzaFrase: t.rejilla.fuerzaFrase } }));
})()`), null, 1));

await ev(`document.querySelectorAll('.row')[0].querySelector('.idx').click()`);
await sleep(1500);
await ev(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('Mezclador')).click()`);
await sleep(1800);

console.log('lo que ve el visor:');
console.log(JSON.stringify(await ev(`(async () => {
  const m = await import('./mezclador.js');
  const st = await import('./state.js');
  const ov = await import('../shared/onda-vista.js');
  const ficha = m.fichaDeMezcla(st.state.currentId);
  const p = await import('./player.js');
  const centro = p.currentTime();
  const { desde, hasta } = ov.ventana(centro, 8);
  const lineas = ov.lineasDeRejilla(ficha?.rejilla ?? null, { desde, hasta });
  return {
    hayFicha: Boolean(ficha), bpmFicha: ficha?.bpm ?? 0, hayRejilla: Boolean(ficha?.rejilla),
    analizada: ficha?.analizada, centro: Math.round(centro * 100) / 100,
    lineas: lineas.length, tipos: [...new Set(lineas.map(l => l.tipo))],
  };
})()`), null, 1));

// Y en el lienzo: ¿hay píxeles de rejilla, o solo onda?
console.log('pixeles del lienzo ampliado:', JSON.stringify(await ev(`(() => {
  const c = document.querySelector('[data-onda="zoom-a"]');
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  // Una línea de rejilla llega arriba del todo, donde la onda no llega nunca.
  const alto = c.height;
  let arriba = 0;
  for (let x = 0; x < c.width; x += 1) {
    const i = (2 * c.width + x) * 4;
    if (d[i + 3] > 20) arriba += 1;
  }
  return { ancho: c.width, alto, columnasConTintaArriba: arriba };
})()`)));
await fin(0, 'listo');
