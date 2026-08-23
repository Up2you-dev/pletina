import { contextBridge, ipcRenderer, webUtils } from 'electron';

/**
 * La única puerta entre la interfaz y el sistema.
 *
 * El renderizador no tiene Node, ni `require`, ni rutas absolutas: pide cosas
 * por su identificador y el proceso principal decide si existen. Lo que no esté
 * en este objeto, no se puede hacer desde la interfaz.
 */
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

function subscribe(channel) {
  return (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

contextBridge.exposeInMainWorld('pletina', {
  platform: process.platform,
  isMac: process.platform === 'darwin',

  library: {
    snapshot: () => invoke('library:snapshot'),
    addFolders: () => invoke('library:addFolders'),
    addFiles: () => invoke('library:addFiles'),
    addPaths: (paths) => invoke('library:addPaths', paths),
    removeFolder: (folderPath) => invoke('library:removeFolder', folderPath),
    rescan: () => invoke('library:rescan'),
    stopScan: () => invoke('library:stopScan'),
    removeTracks: (ids) => invoke('library:removeTracks', ids),
    removeMissing: () => invoke('library:removeMissing'),
    reveal: (id) => invoke('library:reveal', id),
    trash: (id) => invoke('library:trash', id),
  },

  track: {
    patch: (id, patch) => invoke('track:patch', id, patch),
    played: (id) => invoke('track:played', id),
  },

  playlists: {
    create: (name, trackIds) => invoke('playlist:create', name, trackIds),
    update: (id, patch) => invoke('playlist:update', id, patch),
    add: (id, trackIds) => invoke('playlist:add', id, trackIds),
    remove: (id) => invoke('playlist:delete', id),
    reorder: (ids) => invoke('playlist:reorder', ids),
    importFile: () => invoke('playlist:import'),
    exportFile: (id) => invoke('playlist:export', id),
  },

  settings: {
    get: () => invoke('settings:get'),
    patch: (patch) => invoke('settings:patch', patch),
  },

  app: {
    info: () => invoke('app:info'),
    openDataDir: () => invoke('app:openDataDir'),
    /** Abre el menú nativo bajo el botón (Windows dibuja su barra de título aparte). */
    menu: (x, y) => invoke('app:menu', x, y),
  },

  /** URLs servidas por el esquema propio: nunca `file://`, nunca rutas del disco. */
  media: {
    track: (id) => `pletina-media://track/${encodeURIComponent(id)}`,
    cover: (coverId) => `pletina-media://cover/${encodeURIComponent(coverId)}`,
  },

  /** Rutas reales de lo que se suelta en la ventana (Electron ya no expone `File.path`). */
  pathsFromDrop: (fileList) => Array.from(fileList || [])
    .map((file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return '';
      }
    })
    .filter(Boolean),

  on: {
    command: subscribe('command'),
    libraryChanged: subscribe('library:changed'),
    libraryProgress: subscribe('library:progress'),
    libraryWarning: subscribe('library:warning'),
    themeChanged: subscribe('theme:changed'),
  },
});
