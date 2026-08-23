import path from 'node:path';
import { protocol } from 'electron';
import { contentTypeFor, extname } from '../shared/audio-files.js';
import { notFound, serveFile, serveRanged } from './file-response.js';

export const APP_SCHEME = 'pletina';
export const MEDIA_SCHEME = 'pletina-media';

/**
 * Los dos esquemas propios de la aplicación, declarados antes de que arranque
 * Electron:
 *
 *  - `pletina://` sirve la interfaz. Al no ser `file://`, la ventana tiene un
 *    origen real: los módulos ES cargan y la CSP se puede apretar de verdad.
 *  - `pletina-media://` sirve audio y carátulas, y solo de archivos que estén en
 *    la biblioteca. El renderizador nunca ve una ruta absoluta ni puede pedir
 *    otra cosa.
 */
export function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
    },
    {
      scheme: MEDIA_SCHEME,
      // `corsEnabled` no es adorno: sin él, un `<audio crossorigin>` apuntando a
      // este esquema entra en el grafo de Web Audio contaminado y suena a
      // silencio, sin un solo error en consola.
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

const UI_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Engancha los manejadores. `resolveTrack` y `resolveCover` son la única puerta:
 * lo que no devuelvan, no se sirve.
 */
export function handleProtocols({ rendererDir, sharedDir, resolveTrack, resolveCover }) {
  // `/shared/…` son los módulos que comparten interfaz y proceso principal; el
  // resto sale de la carpeta de la interfaz. Cualquier otra ruta no existe.
  const roots = [
    { prefix: 'shared/', dir: sharedDir },
    { prefix: '', dir: rendererDir },
  ];

  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const root = roots.find((candidate) => relative.startsWith(candidate.prefix));
    const target = path.join(root.dir, relative.slice(root.prefix.length));
    // Nada fuera de esas dos carpetas, pase lo que pase en la URL.
    if (!target.startsWith(root.dir + path.sep)) return notFound();
    return serveFile(target, UI_TYPES[extname(target)] || 'application/octet-stream');
  });

  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url);
    const id = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (!id) return notFound();
    if (url.hostname === 'track') {
      const file = resolveTrack(id);
      return file ? serveRanged(file, request) : notFound();
    }
    if (url.hostname === 'cover') {
      const file = resolveCover(id);
      return file ? serveFile(file, contentTypeFor(file), { cors: true }) : notFound();
    }
    return notFound();
  });
}

export const appUrl = (file = 'index.html') => `${APP_SCHEME}://app/${file}`;
export const trackUrl = (id) => `${MEDIA_SCHEME}://track/${encodeURIComponent(id)}`;
export const coverUrl = (coverId) => `${MEDIA_SCHEME}://cover/${encodeURIComponent(coverId)}`;
