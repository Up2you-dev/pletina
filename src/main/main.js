import { statSync, watch } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BrowserWindow,
  Menu,
  app,
  dialog,
  globalShortcut,
  ipcMain,
  nativeTheme,
  powerMonitor,
  shell,
} from 'electron';
import { createStore } from './store.js';
import { createCoverCache } from './covers.js';
import { createOndaStore } from './ondas.js';
import { LIBRARY_DEFAULTS, createLibrary } from './library.js';
import { APP_SCHEME, appUrl, handleProtocols, registerSchemes } from './protocols.js';
import { buildMenu } from './menu.js';
import { isAudioPath } from '../shared/audio-files.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererDir = path.join(here, '..', 'renderer');
const sharedDir = path.join(here, '..', 'shared');
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
// Las herramientas de desarrollo solo se abren si se piden: `npm start` es la
// aplicación, no un banco de pruebas.
const isDev = process.argv.includes('--dev') || Boolean(process.env.PLETINA_DEV);

app.setName('Pletina');
// Un reproductor de música local no debe pedir un clic para sonar: sin esto,
// Chromium deja el contexto de audio suspendido y el ecualizador no arranca.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Windows agrupa la ventana en la barra de tareas y ancla el acceso directo por
// este identificador. Sin él, la aplicación aparece como «Electron».
if (isWin) app.setAppUserModelId('es.up2you.pletina');
registerSchemes();

const SETTINGS_DEFAULTS = {
  volume: 0.9,
  muted: false,
  shuffle: false,
  repeat: 'off',
  normalize: false,
  eq: { activado: false, preset: 'plano', bandas: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preamp: 0 },
  crossfade: 0,
  visualizador: false,
  escribirEtiquetas: false,
  mezclador: { auto: false, compases: 8, estilo: 'bombo', ajustarTempo: true, estirarTiempo: true },
  theme: 'system',
  queueOpen: false,
  sort: { key: 'added', dir: 'desc' },
  ordenAlbumes: { key: 'artista', dir: 'asc' },
  ordenArtistas: { key: 'nombre', dir: 'asc' },
  ignorarArticulos: true,
  view: { type: 'library', id: null },
  last: { trackId: null, position: 0 },
  window: { width: 1180, height: 760, x: null, y: null, maximized: false },
};

let mainWindow = null;
let library = null;
let settings = null;
let libraryStore = null;
let ondasStore = null;
const watchers = new Map();
let watchTimer = null;
const pendingWatched = new Set();
let bootFiles = [];

/* ------------------------------------------------------------------ ventana */

/**
 * En Windows la barra de título se dibuja dentro de la aplicación y solo los
 * botones de ventana los pone el sistema, superpuestos. Hay que darles los
 * colores del tema o quedan recortados sobre un fondo que no es el suyo.
 */
function titleBarOverlay() {
  const dark = nativeTheme.shouldUseDarkColors;
  return {
    color: dark ? '#171722' : '#FBFAFE',
    symbolColor: dark ? '#ECEAF4' : '#191823',
    height: 56,
  };
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

const sendCommand = (name, payload = {}) => send('command', { name, ...payload });

function createWindow() {
  const saved = settings.data.window ?? SETTINGS_DEFAULTS.window;
  mainWindow = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    ...(Number.isFinite(saved.x) && Number.isFinite(saved.y) ? { x: saved.x, y: saved.y } : {}),
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Pletina',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#101018' : '#F2F1F7',
    // La ventana sin marco propio es lo que separa una aplicación de una web
    // enmarcada: en macOS con los semáforos embutidos, en Windows con los
    // botones del sistema superpuestos sobre la barra de la aplicación.
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 17 } } : {}),
    ...(isWin ? { titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlay() } : {}),
    webPreferences: {
      preload: path.join(here, '..', 'preload', 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Los preload en módulos ES exigen desactivar el sandbox; el aislamiento
      // de contextos sigue en pie y el renderizador no ve Node por ningún lado.
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  if (saved.maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(appUrl());

  const persistBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
    const bounds = mainWindow.getNormalBounds();
    settings.update((d) => {
      d.window = { ...bounds, maximized: mainWindow.isMaximized() };
    });
  };
  mainWindow.on('resize', persistBounds);
  mainWindow.on('move', persistBounds);
  mainWindow.on('close', persistBounds);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Nada de navegar fuera de la aplicación ni de abrir ventanas nuevas.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${APP_SCHEME}://`)) event.preventDefault();
  });

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

function focusWindow() {
  if (!mainWindow) return createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  return mainWindow;
}

/* --------------------------------------------------------------- vigilancia */

/** Cambios en las carpetas de la biblioteca: se reanaliza en diferido y en bloque. */
function watchFolders() {
  const wanted = new Set(library.snapshot().folders.map((f) => f.path));
  for (const [folder, watcher] of watchers) {
    if (!wanted.has(folder)) {
      watcher.close();
      watchers.delete(folder);
    }
  }
  for (const folder of wanted) {
    if (watchers.has(folder)) continue;
    try {
      const watcher = watch(folder, { recursive: true, persistent: false }, (_event, filename) => {
        if (filename && !isAudioPath(filename) && !/(^|[\\/])(cover|folder|front)\./i.test(filename)) return;
        pendingWatched.add(folder);
        if (watchTimer) clearTimeout(watchTimer);
        watchTimer = setTimeout(runWatchedScan, 4000);
      });
      watcher.on('error', () => {
        watcher.close();
        watchers.delete(folder);
      });
      watchers.set(folder, watcher);
    } catch {
      // Algunos sistemas de archivos (o los límites de inotify) no lo permiten:
      // se sigue sin vigilancia, el usuario siempre puede reanalizar a mano.
    }
  }
}

async function runWatchedScan() {
  watchTimer = null;
  if (library.isScanning || !pendingWatched.size) return;
  const folders = [...pendingWatched];
  pendingWatched.clear();
  const summary = await library.scan(folders);
  if (summary.added || summary.updated || summary.missing) send('library:changed', { reason: 'watch', summary });
}

/* ------------------------------------------------------------------- humo */

/**
 * Comprobación de arranque para CI y para uno mismo: levanta la aplicación de
 * verdad —protocolos, almacenes, ventana, interfaz—, guarda una captura y sale.
 * Si el renderizador escupe un solo error por consola, el código de salida lo dice.
 *
 *   PLETINA_SMOKE=/tmp/captura.png npm start
 */
function armSmokeTest(target) {
  const problems = [];
  mainWindow.webContents.on('console-message', (...args) => {
    // La firma cambió con Electron 30: se aceptan las dos.
    const details = typeof args[0] === 'object' && args[0] && 'message' in args[0]
      ? args[0]
      : { level: args[1], message: args[2], sourceId: args[4] };
    const level = String(details.level ?? '');
    const line = `[interfaz] ${level}: ${details.message}`;
    process.stdout.write(`${line}\n`);
    if (level === 'error' || level === 3) problems.push(line);
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    problems.push(`did-fail-load ${code} ${description}`);
  });

  /**
   * El menú vive aquí y quien lo obedece vive en el renderizador; entre los dos
   * solo hay una cadena de texto. Se pulsa una opción de verdad y se comprueba
   * que la interfaz reacciona: si ese camino se rompe, el menú se abre, se pulsa
   * y no pasa nada, que es un fallo mudo.
   */
  async function comprobarMenu() {
    const buscar = (items, etiqueta) => {
      for (const item of items) {
        if (item.label === etiqueta) return item;
        const dentro = item.submenu ? buscar(item.submenu.items, etiqueta) : null;
        if (dentro) return dentro;
      }
      return null;
    };
    const opcion = buscar(Menu.getApplicationMenu()?.items ?? [], 'En 15 minutos');
    if (!opcion) {
      problems.push('el menú no tiene la opción del temporizador');
      return;
    }
    opcion.click();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const visible = await mainWindow.webContents
      .executeJavaScript('!document.querySelector("#sleep").hidden')
      .catch(() => false);
    if (!visible) problems.push('el menú no ha llegado a la interfaz (temporizador)');
    else process.stdout.write('menú → interfaz: correcto\n');
  }

  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      await comprobarMenu();
      try {
        const image = await mainWindow.webContents.capturePage();
        await writeFile(target, image.toPNG());
        process.stdout.write(`captura en ${target}\n`);
      } catch (err) {
        problems.push(`captura fallida: ${err.message}`);
      }
      const rendered = await mainWindow.webContents
        .executeJavaScript('({ rail: !!document.querySelector(".nav-item"), title: document.title })')
        .catch((err) => ({ error: err.message }));
      process.stdout.write(`interfaz: ${JSON.stringify(rendered)}\n`);
      if (!rendered.rail) problems.push('la interfaz no ha pintado el raíl');
      process.stdout.write(problems.length ? `HUMO: ${problems.length} problema(s)\n` : 'HUMO: correcto\n');
      app.exit(problems.length ? 1 : 0);
    }, 2500);
  });
}

/* --------------------------------------------------------------- diálogos */

async function pickFolders() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Añadir carpeta a la biblioteca',
    buttonLabel: 'Añadir',
    properties: ['openDirectory', 'multiSelections', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  const summary = await library.addFolders(result.filePaths);
  watchFolders();
  send('library:changed', { reason: 'add-folder', summary });
  return { canceled: false, summary };
}

async function pickFiles() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Añadir archivos a la biblioteca',
    buttonLabel: 'Añadir',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wav', 'wma', 'aiff', 'aif'] }],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  const summary = await library.addFiles(result.filePaths);
  send('library:changed', { reason: 'add-files', summary });
  return { canceled: false, summary };
}

async function importPlaylistDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar lista de reproducción',
    properties: ['openFile'],
    filters: [{ name: 'Listas', extensions: ['m3u', 'm3u8'] }],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  const outcome = await library.importPlaylist(result.filePaths[0]);
  send('library:changed', { reason: 'import-playlist', summary: outcome });
  return { canceled: false, ...outcome };
}

async function rescan() {
  const summary = await library.rescan();
  send('library:changed', { reason: 'rescan', summary });
  return summary;
}

/* ------------------------------------------------------------------- atajos */

/** Teclas de medios del teclado. Si el sistema no las cede, se sigue sin ellas. */
function registerMediaKeys() {
  const keys = [
    ['MediaPlayPause', 'play:toggle'],
    ['MediaNextTrack', 'play:next'],
    ['MediaPreviousTrack', 'play:prev'],
    ['MediaStop', 'play:stop'],
  ];
  for (const [key, command] of keys) {
    try {
      globalShortcut.register(key, () => sendCommand(command));
    } catch {
      /* sin permiso del sistema: no es un error que deba parar la aplicación */
    }
  }
}

/* ---------------------------------------------------------------------- IPC */

function registerIpc() {
  const handle = (channel, fn) => ipcMain.handle(channel, (_event, ...args) => fn(...args));

  handle('library:snapshot', () => library.snapshot());
  handle('library:addFolders', () => pickFolders());
  handle('library:addFiles', () => pickFiles());
  handle('library:addPaths', async (paths) => {
    // Lo que se suelta sobre la ventana: carpetas y archivos mezclados.
    const folders = [];
    const files = [];
    for (const candidate of paths) {
      try {
        if (statSync(candidate).isDirectory()) folders.push(candidate);
        else if (isAudioPath(candidate)) files.push(candidate);
      } catch {
        /* ruta que ya no existe */
      }
    }
    let summary = { added: 0, scanned: 0 };
    if (folders.length) summary = await library.addFolders(folders);
    if (files.length) {
      const extra = await library.addFiles(files);
      summary = { ...summary, added: (summary.added || 0) + extra.added, scanned: (summary.scanned || 0) + extra.scanned };
    }
    watchFolders();
    send('library:changed', { reason: 'drop', summary });
    return summary;
  });
  handle('library:removeFolder', (folderPath) => {
    library.removeFolder(folderPath);
    watchFolders();
    send('library:changed', { reason: 'remove-folder' });
    return library.snapshot();
  });
  handle('library:rescan', () => rescan());
  handle('library:stopScan', () => library.stopScan());
  handle('library:removeTracks', (ids) => {
    library.removeTracks(ids);
    ondasStore.borrar(ids);
    return { removed: ids.length };
  });
  handle('library:removeMissing', () => {
    const fuera = library.removeMissing();
    ondasStore.borrar(fuera);
    return { removed: fuera.length };
  });
  handle('library:reveal', (id) => {
    const track = library.getTrack(id);
    if (track) shell.showItemInFolder(track.path);
    return Boolean(track);
  });
  handle('library:trash', async (id) => {
    const track = library.getTrack(id);
    if (!track) return { ok: false };
    // Doble confirmación: la del renderizador es estética, esta es la que cuenta.
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Cancelar', 'Mover a la papelera'],
      defaultId: 0,
      cancelId: 0,
      message: `¿Mover «${track.title}» a la papelera del sistema?`,
      detail: `${track.path}\n\nSe puede recuperar desde la papelera.`,
    });
    if (response !== 1) return { ok: false, canceled: true };
    try {
      await shell.trashItem(track.path);
      library.removeTracks([id]);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  handle('track:patch', (id, patch) => {
    const allowed = {};
    if ('favorite' in patch) allowed.favorite = Boolean(patch.favorite);
    if (Number.isFinite(patch.duration) && patch.duration > 0) allowed.duration = patch.duration;
    return library.patchTrack(id, allowed);
  });
  handle('track:played', (id) => library.registerPlay(id));
  // La lista blanca de campos vive en la biblioteca: aquí solo se comprueba la forma.
  handle('tracks:edit', async (ids, patch, opciones) => {
    const lista = Array.isArray(ids) ? ids : [];
    const resultado = library.editTracks(lista, patch && typeof patch === 'object' ? patch : {});
    // Escribir en los archivos del usuario solo si se ha pedido explícitamente.
    if (opciones?.escribir) resultado.archivos = await library.escribirEnArchivos(lista);
    return resultado;
  });
  handle('tracks:write', (ids) => library.escribirEnArchivos(Array.isArray(ids) ? ids : []));
  handle('tracks:analysis', async (id, datos) => {
    // La onda no cabe en la biblioteca: son cien kilobytes por canción y ese
    // archivo se lee entero en cada arranque. Va a su carpeta, y en la
    // biblioteca queda solo la nota de que existe.
    const { ondas, ...resto } = datos ?? {};
    const onda = ondas ? await ondasStore.guardar(id, ondas) : false;
    return library.setAnalysis(id, { ...resto, onda });
  });
  handle('tracks:onda', (id) => ondasStore.leer(id));
  handle('tracks:rejilla', (id, cambio) => library.ajustarRejilla(id, cambio ?? {}));
  handle('tracks:cover', async (ids, opciones) => {
    const lista = Array.isArray(ids) ? ids : [];
    if (!lista.length) return { ok: false };
    const elegido = await dialog.showOpenDialog(mainWindow, {
      title: 'Elegir una carátula',
      buttonLabel: 'Usar esta imagen',
      properties: ['openFile'],
      filters: [{ name: 'Imágenes', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    if (elegido.canceled || !elegido.filePaths.length) return { ok: false, canceled: true };
    try {
      const resultado = await library.setCover(lista, elegido.filePaths[0]);
      if (opciones?.escribir) resultado.archivos = await library.escribirEnArchivos(lista);
      return { ok: true, ...resultado };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  handle('tracks:coverFromPath', async (ids, imagePath, opciones) => {
    const lista = Array.isArray(ids) ? ids : [];
    if (!lista.length || typeof imagePath !== 'string') return { ok: false };
    try {
      const resultado = await library.setCover(lista, imagePath);
      if (opciones?.escribir) resultado.archivos = await library.escribirEnArchivos(lista);
      return { ok: true, ...resultado };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  handle('tracks:clearCover', (ids) => library.clearCover(Array.isArray(ids) ? ids : []));
  handle('tracks:restore', (ids) => library.restoreTags(Array.isArray(ids) ? ids : []));
  handle('tracks:favorite', (ids, favorite) => library.setFavorite(Array.isArray(ids) ? ids : [], favorite));

  handle('playlist:create', (name, trackIds) => library.createPlaylist(name, trackIds));
  handle('playlist:update', (id, patch) => {
    const allowed = {};
    if (typeof patch.name === 'string') allowed.name = patch.name.slice(0, 120);
    if (Array.isArray(patch.trackIds)) allowed.trackIds = patch.trackIds;
    return library.updatePlaylist(id, allowed);
  });
  handle('playlist:add', (id, trackIds) => library.addToPlaylist(id, trackIds));
  handle('playlist:delete', (id) => library.deletePlaylist(id));
  handle('playlist:reorder', (ids) => library.reorderPlaylists(ids));
  handle('playlist:import', () => importPlaylistDialog());
  handle('playlist:export', async (id) => {
    const playlist = library.playlistById(id);
    if (!playlist) return { ok: false };
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Exportar lista',
      defaultPath: `${playlist.name.replace(/[/\\:*?"<>|]/g, '-')}.m3u8`,
      filters: [{ name: 'Lista M3U', extensions: ['m3u8', 'm3u'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    return library.exportPlaylist(id, result.filePath);
  });

  handle('settings:get', () => settings.data);
  handle('settings:patch', (patch) => {
    settings.update((d) => Object.assign(d, patch));
    if (patch.theme) nativeTheme.themeSource = patch.theme;
    return settings.data;
  });

  handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    dataDir: app.getPath('userData'),
    dark: nativeTheme.shouldUseDarkColors,
  }));
  handle('app:openDataDir', () => shell.openPath(app.getPath('userData')));
  handle('app:menu', (x, y) => {
    // Con la barra de título integrada, Windows no enseña la barra de menús:
    // este es el botón que la abre donde estaría.
    const menu = Menu.getApplicationMenu();
    if (!menu || !mainWindow) return false;
    menu.popup({ window: mainWindow, x: Math.round(x), y: Math.round(y) });
    return true;
  });
}

/* -------------------------------------------------------------- ciclo de vida */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  /** Abre en la ventana que ya existe lo que llega por argumentos o por «abrir con». */
  function openFiles(files) {
    if (!files.length) return;
    // La biblioteca puede no estar montada todavía: se guardan para el arranque.
    if (!library) {
      bootFiles.push(...files);
      return;
    }
    library.addFiles(files).then(() => {
      send('library:changed', { reason: 'open-with' });
      sendCommand('play:paths', { paths: files });
    });
  }

  app.on('second-instance', (_event, argv) => {
    if (library) focusWindow();
    openFiles(argv.filter((arg) => isAudioPath(arg)));
  });

  // «Abrir con Pletina» en macOS puede llegar antes de que la aplicación esté lista.
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (library) focusWindow();
    openFiles([filePath]);
  });

  app.whenReady().then(async () => {
    const userData = app.getPath('userData');
    libraryStore = createStore({ dir: userData, name: 'biblioteca', defaults: LIBRARY_DEFAULTS, debounceMs: 800 });
    settings = createStore({ dir: userData, name: 'ajustes', defaults: SETTINGS_DEFAULTS, debounceMs: 400 });
    const [libraryLoad] = await Promise.all([libraryStore.load(), settings.load()]);

    nativeTheme.themeSource = settings.data.theme ?? 'system';

    const covers = createCoverCache(path.join(userData, 'caratulas'));
    ondasStore = createOndaStore(path.join(userData, 'ondas'));
    library = createLibrary({
      store: libraryStore,
      covers,
      onProgress: (payload) => send('library:progress', payload),
    });

    handleProtocols({
      rendererDir,
      sharedDir,
      resolveTrack: (id) => library.getTrack(id)?.path ?? null,
      resolveCover: (coverId) => (/^[a-f0-9]{8,}\.(jpg|png|webp)$/i.test(coverId) ? covers.pathFor(coverId) : null),
    });

    registerIpc();
    createWindow();
    if (process.env.PLETINA_SMOKE) armSmokeTest(process.env.PLETINA_SMOKE);
    buildMenu({
      send: sendCommand,
      onAddFolder: pickFolders,
      onAddFiles: pickFiles,
      onImportPlaylist: importPlaylistDialog,
      onRescan: rescan,
      onOpenDataDir: () => shell.openPath(userData),
      onToggleTheme: () => {
        const next = nativeTheme.shouldUseDarkColors ? 'light' : 'dark';
        nativeTheme.themeSource = next;
        settings.update((d) => {
          d.theme = next;
        });
        send('theme:changed', { theme: next, dark: next === 'dark' });
      },
    });
    registerMediaKeys();

    nativeTheme.on('updated', () => {
      if (isWin && mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitleBarOverlay(titleBarOverlay());
      send('theme:changed', { theme: settings.data.theme, dark: nativeTheme.shouldUseDarkColors });
    });
    powerMonitor.on('suspend', () => sendCommand('play:pause'));

    mainWindow.webContents.once('did-finish-load', async () => {
      if (!libraryLoad.ok) {
        send('library:warning', {
          message: 'El archivo de la biblioteca estaba dañado y se ha apartado. Vuelve a añadir tus carpetas.',
        });
      }
      watchFolders();
      const files = [...new Set([...bootFiles, ...process.argv.slice(1).filter((arg) => isAudioPath(arg))])];
      bootFiles = [];
      if (files.length) {
        await library.addFiles(files);
        send('library:changed', { reason: 'open-with' });
        sendCommand('play:paths', { paths: files });
      }
      // Puesta al día silenciosa: si algo cambió con la aplicación cerrada, aquí se ve.
      if (library.snapshot().folders.length) {
        const summary = await library.rescan();
        if (summary.added || summary.updated || summary.missing) {
          send('library:changed', { reason: 'arranque', summary });
        }
      }
    });

    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });

  app.on('before-quit', async () => {
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
    await Promise.all([libraryStore?.flush(), settings?.flush()]);
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    libraryStore?.flushSync();
    settings?.flushSync();
  });
}
