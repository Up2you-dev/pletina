import { Menu, app, shell } from 'electron';

const isMac = process.platform === 'darwin';

/**
 * Los atajos que el propio renderizador escucha.
 *
 * En Windows el menú va oculto, así que sus atajos son la única forma de
 * llegar a estas órdenes y por eso el renderizador los escucha también. Pero
 * entonces un mismo Ctrl+P llegaría dos veces —una por el menú, otra por la
 * ventana— y la canción se pararía y arrancaría en el mismo golpe de tecla.
 * La etiqueta se sigue enseñando; lo que se quita es el registro del atajo.
 */
const ATAJOS_DEL_RENDERIZADOR = new Set([
  'CmdOrCtrl+F', 'CmdOrCtrl+P', 'CmdOrCtrl+Right', 'CmdOrCtrl+Left',
  'CmdOrCtrl+Up', 'CmdOrCtrl+Down', 'CmdOrCtrl+M', 'CmdOrCtrl+S', 'CmdOrCtrl+R',
  'CmdOrCtrl+U', 'CmdOrCtrl+E', 'CmdOrCtrl+/',
  'CmdOrCtrl+1', 'CmdOrCtrl+2', 'CmdOrCtrl+3', 'CmdOrCtrl+4', 'CmdOrCtrl+5',
  'Alt+Right', 'Alt+Left',
]);

/** Recorre la plantilla y desregistra los atajos que ya escucha la ventana. */
function soltarAtajosRepetidos(items) {
  for (const item of items) {
    if (ATAJOS_DEL_RENDERIZADOR.has(item.accelerator)) item.registerAccelerator = false;
    if (Array.isArray(item.submenu)) soltarAtajosRepetidos(item.submenu);
  }
  return items;
}

/**
 * Menú nativo. Es la diferencia visible entre «una web en una ventana» y una
 * aplicación: los atajos del sistema, el menú de la barra y el nombre real del
 * programa. Cada opción manda una orden al renderizador, que es quien sabe qué
 * suena.
 */
export function buildMenu({ send, onAddFolder, onAddFiles, onImportPlaylist, onRescan, onOpenDataDir, onToggleTheme }) {
  const command = (name, payload) => () => send(name, payload);

  const template = [
    ...(isMac
      ? [{
        label: app.name,
        submenu: [
          { role: 'about', label: `Acerca de ${app.name}` },
          { type: 'separator' },
          { role: 'services', label: 'Servicios' },
          { type: 'separator' },
          { role: 'hide', label: `Ocultar ${app.name}` },
          { role: 'hideOthers', label: 'Ocultar otros' },
          { role: 'unhide', label: 'Mostrar todo' },
          { type: 'separator' },
          { role: 'quit', label: `Salir de ${app.name}` },
        ],
      }]
      : []),
    {
      label: 'Archivo',
      submenu: [
        { label: 'Añadir carpeta a la biblioteca…', accelerator: 'CmdOrCtrl+O', click: () => onAddFolder() },
        { label: 'Añadir archivos…', accelerator: 'CmdOrCtrl+Shift+O', click: () => onAddFiles() },
        { type: 'separator' },
        { label: 'Importar lista M3U…', click: () => onImportPlaylist() },
        { label: 'Exportar lista actual…', click: command('playlist:export') },
        { type: 'separator' },
        { label: 'Analizar la biblioteca de nuevo', accelerator: 'CmdOrCtrl+Alt+R', click: () => onRescan() },
        { type: 'separator' },
        isMac ? { role: 'close', label: 'Cerrar ventana' } : { role: 'quit', label: 'Salir' },
      ],
    },
    {
      label: 'Edición',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' },
        { type: 'separator' },
        { label: 'Buscar en la biblioteca', accelerator: 'CmdOrCtrl+F', click: command('focus:search') },
      ],
    },
    {
      label: 'Reproducción',
      submenu: [
        { label: 'Reproducir / Pausa', accelerator: 'CmdOrCtrl+P', click: command('play:toggle') },
        { label: 'Siguiente', accelerator: 'CmdOrCtrl+Right', click: command('play:next') },
        { label: 'Anterior', accelerator: 'CmdOrCtrl+Left', click: command('play:prev') },
        { type: 'separator' },
        { label: 'Adelantar 10 s', accelerator: 'Alt+Right', click: command('seek:forward') },
        { label: 'Retroceder 10 s', accelerator: 'Alt+Left', click: command('seek:back') },
        { type: 'separator' },
        { label: 'Subir volumen', accelerator: 'CmdOrCtrl+Up', click: command('volume:up') },
        { label: 'Bajar volumen', accelerator: 'CmdOrCtrl+Down', click: command('volume:down') },
        { label: 'Silenciar', accelerator: 'CmdOrCtrl+M', click: command('volume:mute') },
        { type: 'separator' },
        { label: 'Orden aleatorio', accelerator: 'CmdOrCtrl+S', click: command('toggle:shuffle') },
        { label: 'Repetir', accelerator: 'CmdOrCtrl+R', click: command('toggle:repeat') },
        { label: 'Volumen constante (ReplayGain)', click: command('toggle:normalize') },
        { type: 'separator' },
        {
          label: 'Temporizador de apagado',
          submenu: [
            { label: 'Al terminar esta canción', click: command('sleep:set', { minutos: 'cancion' }) },
            { type: 'separator' },
            { label: 'En 15 minutos', click: command('sleep:set', { minutos: 15 }) },
            { label: 'En 30 minutos', click: command('sleep:set', { minutos: 30 }) },
            { label: 'En 45 minutos', click: command('sleep:set', { minutos: 45 }) },
            { label: 'En 1 hora', click: command('sleep:set', { minutos: 60 }) },
            { type: 'separator' },
            { label: 'Desactivar', click: command('sleep:set', { minutos: 0 }) },
          ],
        },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { label: 'Biblioteca', accelerator: 'CmdOrCtrl+1', click: command('view:library') },
        { label: 'Álbumes', accelerator: 'CmdOrCtrl+2', click: command('view:albums') },
        { label: 'Artistas', accelerator: 'CmdOrCtrl+3', click: command('view:artists') },
        { label: 'Favoritos', accelerator: 'CmdOrCtrl+4', click: command('view:favorites') },
        { label: 'Escuchado hace poco', accelerator: 'CmdOrCtrl+5', click: command('view:recent') },
        { type: 'separator' },
        { label: 'Cola de reproducción', accelerator: 'CmdOrCtrl+U', click: command('toggle:queue') },
        { label: 'Cambiar entre claro y oscuro', accelerator: 'CmdOrCtrl+Shift+L', click: () => onToggleTheme() },
        { label: 'Visualizador', accelerator: 'CmdOrCtrl+Shift+V', click: command('toggle:visualizador') },
        { label: 'Ecualizador y mezcla…', accelerator: 'CmdOrCtrl+E', click: command('abrir:sonido') },
        { type: 'separator' },
        { label: 'Al ordenar, ignorar «el», «la», «the»…', click: command('toggle:articulos') },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Tamaño normal' },
        { role: 'zoomIn', label: 'Aumentar' },
        { role: 'zoomOut', label: 'Reducir' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
        ...(process.env.PLETINA_DEV || !app.isPackaged
          ? [{ role: 'toggleDevTools', label: 'Herramientas de desarrollo' }]
          : []),
      ],
    },
    {
      label: 'Ventana',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        ...(isMac
          ? [{ role: 'zoom', label: 'Zoom' }, { type: 'separator' }, { role: 'front', label: 'Traer todo al frente' }]
          : [{ role: 'close', label: 'Cerrar' }]),
      ],
    },
    {
      role: 'help',
      label: 'Ayuda',
      submenu: [
        { label: 'Atajos de teclado', accelerator: 'CmdOrCtrl+/', click: command('help:shortcuts') },
        { label: 'Abrir la carpeta de datos de Pletina', click: () => onOpenDataDir() },
        { type: 'separator' },
        {
          label: 'Sobre Pletina',
          click: () => send('help:about', { version: app.getVersion() }),
        },
        ...(isMac ? [] : [{ label: 'Licencias de las tipografías', click: () => shell.openExternal('https://openfontlicense.org') }]),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(soltarAtajosRepetidos(template));
  Menu.setApplicationMenu(menu);
  return menu;
}
