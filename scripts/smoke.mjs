import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

/**
 * Arranca la aplicación de verdad en un perfil desechable, comprueba que la
 * interfaz se pinta sin errores y guarda una captura. En Linux sin escritorio
 * hace falta `xvfb-run`; el script lo detecta y lo usa si está.
 */
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = await mkdtemp(path.join(tmpdir(), 'pletina-smoke-'));
const shot = path.join(profile, 'captura.png');
const headless = process.platform === 'linux' && !process.env.DISPLAY;

const args = [root, '--no-sandbox', `--user-data-dir=${profile}`];
const command = headless ? 'xvfb-run' : electron;
const commandArgs = headless ? ['-a', electron, ...args] : args;

const child = spawn(command, commandArgs, {
  env: { ...process.env, PLETINA_SMOKE: shot, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  stdio: ['ignore', 'inherit', 'inherit'],
});

const timeout = setTimeout(() => {
  console.error('HUMO: la aplicación no ha terminado a tiempo');
  child.kill('SIGKILL');
  process.exitCode = 1;
}, 60000);

child.on('exit', async (code) => {
  clearTimeout(timeout);
  let captured = false;
  try {
    captured = (await stat(shot)).size > 1000;
  } catch {
    captured = false;
  }
  if (code === 0 && captured) console.log('HUMO: arranque correcto, captura generada');
  else console.error(`HUMO: fallo (código ${code}, captura ${captured ? 'sí' : 'no'})`);
  await rm(profile, { recursive: true, force: true });
  process.exit(code === 0 && captured ? 0 : 1);
});
