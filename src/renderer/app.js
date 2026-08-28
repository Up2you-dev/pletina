import {
  advance,
  createQueue,
  dropManual,
  enqueueLast,
  enqueueNext,
  reshuffle,
  retreat,
  withoutIds,
} from '../shared/queue.js';
import { plural } from '../shared/format.js';
import { sortTracks } from '../shared/sorting.js';
import * as player from './player.js';
import {
  albumByKey,
  artistByKey,
  canReorder,
  clearSelection,
  getTrack,
  normalize,
  opcionesDeOrden,
  playlistById,
  normalizeView,
  setQuery,
  setTracks,
  state,
  visibleTracks,
} from './state.js';
import { $, closePop, dialog, esc, isDialogOpen, popover, toast } from './ui/dom.js';
import { bindRail, playlistMenu, renderRail } from './ui/rail.js';
import { bindStage, refreshRows, renderStage, renderStageHead, scrollToCurrent } from './ui/stage.js';
import { bindQueue, renderQueue } from './ui/queue.js';
import { abrirSonido, bindSonido, cerrarSonido } from './ui/sonido.js';
import { alternarVisualizador, montarVisualizador } from './ui/visualizador.js';
import { esReproducible } from '../shared/audio-files.js';
import { analizada, rejillaVigente } from '../shared/beats.js';
import { analizarPista } from './analisis.js';
import { analizandoLote, analizarLote, cancelarLote } from './analisis-lote.js';
import { olvidarOnda } from './ondas.js';
import {
  alCambiarMezclador,
  cambiarAjustes,
  cambiarOctavaEnB,
  cargarEnPlatoB,
  marcandoTempo,
  marcarTempoEnB,
  margenAutomatico,
  mezclarAhora,
  platoB,
  ponerElUnoEnB,
  saltarCompasesEnB,
  soltarPlatoB,
  terminarMezcla,
} from './mezclador.js';
import { bindCabina, buscarParaPlatoB, cambiarZoom } from './ui/vista-mezclador.js';
import {
  bindTransport,
  helpPopover,
  renderNowPlaying,
  renderPlayState,
  syncToggles,
  tick,
} from './ui/transport.js';

const api = window.pletina;
let appInfo = { version: '', electron: '', dataDir: '', dark: false };
let countedFor = null;
/** El repintado que espera a que se acabe la ráfaga de golpecitos del tempo. */
let esperandoGolpes = null;

/**
 * Temporizador de apagado. Guarda el instante en que hay que bajar la música, o
 * la marca `'cancion'` para parar cuando termine lo que está sonando.
 */
const dormir = { hasta: null, alTerminar: false, reloj: 0 };

/* ------------------------------------------------------------- repintados */

const renderAll = () => {
  renderRail();
  renderStage();
  renderQueue();
};

function persist(patch) {
  api.settings.patch(patch);
}

async function refreshLibrary({ keepScroll = true } = {}) {
  const snapshot = await api.library.snapshot();
  const scroll = keepScroll ? $('#stage').scrollTop : 0;
  setTracks(snapshot.tracks);
  state.playlists = snapshot.playlists;
  state.folders = snapshot.folders;
  // Lo que ya no exista sale de la cola y de la selección.
  state.queue = withoutIds(state.queue, state.queue.order.filter((id) => !state.byId.has(id)));
  for (const id of [...state.selection]) if (!state.byId.has(id)) state.selection.delete(id);
  if (state.currentId && !state.byId.has(state.currentId)) {
    player.stop();
    state.currentId = null;
  }
  // Y el plato preparado, que si no la cabina se queda diciendo «Nada cargado»
  // con seis botones activos sobre una canción que ya no existe.
  const preparada = player.estadoPreparado().id;
  if (preparada && !state.byId.has(preparada)) soltarPlatoB();
  normalizeView();
  renderAll();
  renderNowPlaying();
  if (keepScroll) $('#stage').scrollTop = scroll;
}

/* ----------------------------------------------------------- reproducción */

function loadAndPlay(id, { play = true, position = 0 } = {}) {
  countedFor = null;
  if (!player.load(id, { play, position })) return;
  const next = [...state.queue.manual, ...state.queue.order.slice(state.queue.index + 1)][0];
  player.warmNext(next);
  renderNowPlaying();
  refreshRows();
  renderQueue();
  // Y la cabina, que si no se queda con el título, la carátula y las
  // sugerencias de la canción anterior mientras el plato ya dibuja la nueva:
  // la pantalla contradiciéndose a sí misma.
  if (state.view.type === 'mezclador') renderStage();
  persist({ last: { trackId: id, position } });
}

function playIds(ids, startId) {
  if (!ids.length) return;
  state.queue = createQueue(ids, { startId: startId ?? ids[0], shuffled: state.shuffle });
  loadAndPlay(state.queue.order[state.queue.index]);
}

function playFromView(id) {
  const ids = visibleTracks().map((track) => track.id);
  playIds(ids.includes(id) ? ids : [id], id);
}

function next(auto = false) {
  if (auto && dormir.alTerminar) {
    apagar('Se acabó: buenas noches.');
    return undefined;
  }
  const result = advance(state.queue, { repeat: state.repeat, auto });
  state.queue = result.queue;
  if (result.restart) return player.restart();
  if (!result.id) {
    player.pause();
    player.seekTo(0);
    renderQueue();
    return undefined;
  }
  loadAndPlay(result.id);
  return undefined;
}

function prev() {
  const result = retreat(state.queue, player.currentTime());
  state.queue = result.queue;
  if (result.restart) return player.seekTo(0);
  loadAndPlay(result.id);
  return undefined;
}

/**
 * Se acerca el final de la canción. Con el mezclador automático encendido manda
 * él —tempo, compás y cambio de graves—; si no, queda el fundido de siempre.
 */
function encadenarSiguiente() {
  if (!player.hayMotor()) return;

  if (state.mezclador.auto) {
    const resultado = mezclarAhora();
    if (resultado.ok) {
      countedFor = null;
      refreshRows();
      renderQueue();
      if (state.view.type === 'mezclador') renderStage();
      return;
    }
    // Si el mezclador no puede, se sigue con el fundido normal en vez de callar.
  }

  if (!state.crossfade) return;
  const resultado = advance(state.queue, { repeat: state.repeat, auto: true });
  if (!resultado.id || resultado.restart || resultado.ended) return;
  if (!player.encadenar(resultado.id, { segundos: state.crossfade })) return;
  state.queue = resultado.queue;
  countedFor = null;
  refreshRows();
  renderQueue();
  const siguiente = [...state.queue.manual, ...state.queue.order.slice(state.queue.index + 1)][0];
  player.warmNext(siguiente);
}

function togglePlay() {
  if (!state.currentId) {
    const list = visibleTracks();
    if (!list.length) {
      toast('Añade música para empezar.');
      return;
    }
    playFromView(list[0].id);
    return;
  }
  player.toggle();
}

function setShuffle(value) {
  state.shuffle = value;
  persist({ shuffle: value });
  if (state.queue.order.length) {
    state.queue = reshuffle(state.queue, state.currentId, { shuffled: value });
  }
  syncToggles(appInfo);
  renderQueue();
}

/* ------------------------------------------------------ temporizador */

function pintarTemporizador() {
  const chip = $('#sleep');
  if (dormir.alTerminar) {
    chip.hidden = false;
    chip.textContent = '⏱ al terminar';
    return;
  }
  if (!dormir.hasta) {
    chip.hidden = true;
    return;
  }
  const restan = Math.max(0, Math.round((dormir.hasta - Date.now()) / 60000));
  chip.hidden = false;
  chip.textContent = `⏱ ${restan || '<1'} min`;
}

function apagar(motivo) {
  cancelarTemporizador();
  player.pause();
  toast(motivo);
}

function cancelarTemporizador({ avisar = false } = {}) {
  dormir.hasta = null;
  dormir.alTerminar = false;
  if (dormir.reloj) {
    clearInterval(dormir.reloj);
    dormir.reloj = 0;
  }
  pintarTemporizador();
  if (avisar) toast('Temporizador desactivado');
}

function programarTemporizador(minutos) {
  if (minutos === 0) {
    cancelarTemporizador({ avisar: true });
    return;
  }
  if (minutos === 'cancion') {
    cancelarTemporizador();
    dormir.alTerminar = true;
    pintarTemporizador();
    toast('Se parará al terminar esta canción');
    return;
  }
  cancelarTemporizador();
  dormir.hasta = Date.now() + minutos * 60000;
  dormir.reloj = setInterval(() => {
    if (dormir.hasta && Date.now() >= dormir.hasta) apagar('Se acabó: buenas noches.');
    else pintarTemporizador();
  }, 15000);
  pintarTemporizador();
  toast(`La música se parará en ${minutos} minutos`);
}

/* --------------------------------------------------------------- acciones */

async function withPlaylistPrompt(ids) {
  const name = await dialog({
    title: 'Nueva lista',
    message: ids.length > 1 ? `Se creará con ${plural(ids.length, 'canción', 'canciones')} dentro.` : null,
    input: 'Nombre',
    value: 'Mi lista',
    ok: 'Crear',
  });
  if (!name) return;
  const playlist = await api.playlists.create(name, ids);
  await refreshLibrary({ keepScroll: false });
  state.view = { type: 'playlist', id: playlist.id };
  renderAll();
  toast(`Lista «${playlist.name}» creada`);
}

/** Traduce el parte de la escritura en archivos a una frase corta. */
function contarEscritura(archivos, corregidas = 0, porDefecto = null) {
  if (!archivos) {
    if (corregidas) {
      toast(corregidas > 1
        ? plural(corregidas, 'canción corregida', 'canciones corregidas')
        : 'Información corregida');
    } else if (porDefecto) toast(porDefecto);
    return;
  }
  const { hechos = [], fallidos = [], noSoportados = [] } = archivos;
  const partes = [];
  if (hechos.length) partes.push(`${plural(hechos.length, 'archivo escrito', 'archivos escritos')}`);
  if (noSoportados.length) partes.push(`${noSoportados.length} sin soporte`);
  if (fallidos.length) partes.push(`${fallidos.length} con error`);
  if (!partes.length) {
    toast(porDefecto ?? 'Información corregida');
    return;
  }
  toast(partes.join(' · '));
  // Un formato que no se sabe escribir merece una explicación, no un número.
  if (noSoportados.length) setTimeout(() => toast(noSoportados[0].motivo), 800);
  if (fallidos.length) setTimeout(() => toast(`«${fallidos[0].title}»: ${fallidos[0].error}`), 1600);
}

const actions = {
  navigate(view) {
    state.view = { id: null, key: null, ...view };
    clearSelection();
    $('#stage').scrollTop = 0;
    renderAll();
  },

  play: (id) => playFromView(id),

  playOrPause(id) {
    if (state.currentId === id) player.toggle();
    else playFromView(id);
  },

  enqueueNext(ids) {
    state.queue = enqueueNext(state.queue, ids);
    renderQueue();
    toast(ids.length > 1 ? `${plural(ids.length, 'canción', 'canciones')} a continuación` : 'Sonará a continuación');
  },

  enqueueLast(ids) {
    state.queue = enqueueLast(state.queue, ids);
    renderQueue();
    toast(ids.length > 1 ? `${plural(ids.length, 'canción', 'canciones')} al final de la cola` : 'Añadida al final de la cola');
  },

  async setFavorite(ids, value) {
    for (const id of ids) {
      const track = getTrack(id);
      if (track) track.favorite = value;
    }
    await api.track.favorite(ids, value);
    renderRail();
    if (state.view.type === 'favorites') renderStage();
    else refreshRows();
    renderNowPlaying();
  },

  async addToPlaylist(playlistId, ids) {
    const result = await api.playlists.add(playlistId, ids);
    await refreshLibrary();
    const name = playlistById(playlistId)?.name ?? 'la lista';
    if (!result?.added) toast(`Ya estaba${ids.length > 1 ? 'n' : ''} en «${name}»`);
    else toast(`${plural(result.added, 'canción añadida', 'canciones añadidas')} a «${name}»`);
  },

  newPlaylistWith: (ids) => withPlaylistPrompt(ids),

  async removeFromPlaylist(ids) {
    const playlist = playlistById(state.view.id);
    if (!playlist) return;
    const keep = playlist.trackIds.filter((id) => !ids.includes(id));
    await api.playlists.update(playlist.id, { trackIds: keep });
    await refreshLibrary();
    toast(ids.length > 1 ? `${plural(ids.length, 'canción quitada', 'canciones quitadas')} de la lista` : 'Quitada de la lista');
  },

  async forget(ids) {
    const single = ids.length === 1 ? getTrack(ids[0]) : null;
    const ok = await dialog({
      title: single ? `¿Quitar «${single.title}» de la biblioteca?` : `¿Quitar ${plural(ids.length, 'canción', 'canciones')}?`,
      message: 'Desaparecen de Pletina y de todas las listas. El archivo sigue en tu disco, intacto.',
      ok: 'Quitar',
      danger: true,
    });
    if (!ok) return;
    await api.library.removeTracks(ids);
    clearSelection();
    await refreshLibrary();
    toast(ids.length > 1 ? `${plural(ids.length, 'canción quitada', 'canciones quitadas')}` : 'Canción quitada');
  },

  async trash(id) {
    const result = await api.library.trash(id);
    if (result.canceled) return;
    if (!result.ok) {
      toast('No he podido mover el archivo a la papelera.');
      return;
    }
    await refreshLibrary();
    toast('Archivo movido a la papelera');
  },

  reveal: (id) => api.library.reveal(id),

  /**
   * Tempo, tonalidad y rejilla. Se analiza a petición porque decodificar el
   * audio cuesta segundos por canción: hacerlo con toda la biblioteca al
   * importar sería tenerla bloqueada durante horas.
   *
   * En lote es un trabajo con progreso y con botón de parar, y se salta de
   * serie lo que ya está analizado: volver a analizar mil canciones para
   * cambiar dos es tiempo tirado.
   */
  async analizar(ids, { forzar = false, silencio = false } = {}) {
    if (!ids?.length) {
      if (!silencio) toast('No hay nada que analizar.');
      return null;
    }
    const motor = player.engine();
    if (!motor) {
      toast('Este equipo no permite analizar el audio.');
      return null;
    }
    if (analizandoLote()) {
      toast('Ya hay un análisis en marcha. Puedes pararlo desde el aviso de arriba.');
      return null;
    }

    const chip = $('#chip');
    const texto = $('#chip-text');
    const resumen = await analizarLote(ids, {
      forzar,
      // El análisis ya no usa el contexto de reproducción: decodifica a una
      // tasa fija para que el resultado no dependa de la tarjeta de sonido.
      analizar: (id) => analizarPista(id, getTrack(id)),
      guardar: async (id, resultado) => {
        await api.track.analysis(id, resultado);
        // La onda de antes ya no vale: se vuelve a pedir cuando haga falta.
        olvidarOnda(id);
      },
      yaHecha: (id) => analizada(getTrack(id)),
      titulo: (id) => getTrack(id)?.title ?? '',
      alProgreso: (estado) => {
        if (!estado) {
          chip.classList.remove('show');
          return;
        }
        chip.classList.add('show');
        const cuenta = `${Math.min(estado.hechas + estado.fallidas + 1, estado.total)}/${estado.total}`;
        texto.textContent = estado.titulo
          ? `Analizando ${cuenta} · ${estado.titulo}`
          : `Analizando ${cuenta}`;
      },
    });

    await refreshLibrary();
    renderNowPlaying();
    if (state.view.type === 'mezclador') renderStage();
    if (silencio || !resumen?.ok) return resumen;

    const primera = ids.length === 1 ? getTrack(ids[0]) : null;
    // Los fallos van primero. Antes se anunciaba éxito con el bpm de la
    // ETIQUETA —un dato que ya venía en el archivo— aunque la decodificación
    // hubiera reventado: la aplicación decía «128 pulsaciones · Am» y luego no
    // había ni rejilla ni onda. Decir que sí y enseñar que no es la peor
    // manera de fallar.
    if (resumen.fallidas && !resumen.hechas) {
      toast(resumen.fallidas === 1
        ? `No he podido analizar esa canción${resumen.motivos?.[0] ? `: ${resumen.motivos[0]}` : '.'}`
        : `No he podido analizar ${resumen.fallidas} canciones. Suele ser el formato: AIFF, WMA, ALAC y APE no se pueden decodificar aquí.`);
      return resumen;
    }
    if (resumen.cancelado) {
      toast(`Análisis parado · ${plural(resumen.hechas, 'canción analizada', 'canciones analizadas')}`);
    } else if (!resumen.total && resumen.saltadas) {
      toast(resumen.saltadas === 1 ? 'Esa canción ya estaba analizada.' : 'Ya estaban todas analizadas.');
    } else if (primera && rejillaVigente(primera.rejilla)) {
      toast(`${Math.round(primera.bpm)} pulsaciones por minuto${primera.tonalidad ? ` · ${primera.tonalidad}` : ''}`);
    } else if (resumen.hechas) {
      const saltadas = resumen.saltadas ? ` · ${resumen.saltadas} ya lo estaban` : '';
      const fallidas = resumen.fallidas ? ` · ${resumen.fallidas} con error` : '';
      // Cuántas se han quedado sin rejilla: tienen tempo, pero su pulso no da
      // para pinchar en el compás. Callárselo dejaba al usuario mirando una
      // cabina sin rejilla y sin saber por qué.
      const sinRejilla = ids.filter((id) => {
        const track = getTrack(id);
        return track?.bpm && !rejillaVigente(track.rejilla);
      }).length;
      const sin = sinRejilla ? ` · ${sinRejilla} con tempo pero sin rejilla` : '';
      toast(`${plural(resumen.hechas, 'canción analizada', 'canciones analizadas')}${saltadas}${fallidas}${sin}`);
    } else {
      toast('No he podido analizar el audio.');
    }
    return resumen;
  },

  /**
   * Corregir etiquetas. Con una canción se editan todos los campos; con varias,
   * solo los que se comparten, y lo que se deje en blanco no se toca —así se
   * arregla el álbum de veinte canciones sin machacarles el título.
   */
  async editTags(ids) {
    const varias = ids.length > 1;
    const track = getTrack(ids[0]);
    if (!track) return;
    const comun = (campo) => {
      const valores = new Set(ids.map((id) => String(getTrack(id)?.[campo] ?? '')));
      return valores.size === 1 ? [...valores][0] : '';
    };
    const valor = (campo) => (varias ? comun(campo) : String(track[campo] ?? ''));
    const numero = (campo) => (varias ? '' : String(track[campo] || '') || '');
    const marcador = varias ? '(sin cambios)' : '';

    const campos = varias
      ? [
        { name: 'artist', label: 'Artista', value: valor('artist'), placeholder: marcador },
        { name: 'albumArtist', label: 'Artista del álbum', value: valor('albumArtist'), placeholder: marcador },
        { name: 'album', label: 'Álbum', value: valor('album'), placeholder: marcador },
        { name: 'genre', label: 'Género', value: valor('genre'), placeholder: marcador, ancho: 'medio' },
        { name: 'year', label: 'Año', value: numero('year'), placeholder: marcador, type: 'numero', ancho: 'medio' },
      ]
      : [
        { name: 'title', label: 'Título', value: valor('title') },
        { name: 'artist', label: 'Artista', value: valor('artist') },
        { name: 'albumArtist', label: 'Artista del álbum', value: valor('albumArtist') },
        { name: 'album', label: 'Álbum', value: valor('album') },
        { name: 'genre', label: 'Género', value: valor('genre'), ancho: 'medio' },
        { name: 'year', label: 'Año', value: numero('year'), type: 'numero', ancho: 'medio' },
        { name: 'trackNo', label: 'Pista', value: numero('trackNo'), type: 'numero', ancho: 'medio' },
        { name: 'discNo', label: 'Disco', value: numero('discNo'), type: 'numero', ancho: 'medio' },
      ];

    const valores = await dialog({
      title: varias ? `Corregir ${plural(ids.length, 'canción', 'canciones')}` : 'Corregir la información',
      message: varias
        ? 'Lo que dejes en blanco se queda como está.'
        : [track.bpm ? `${Math.round(track.bpm)} pulsaciones por minuto` : null,
          track.tonalidad || null].filter(Boolean).join(' · ') || null,
      fields: campos,
      check: {
        name: 'escribir',
        label: 'Escribir también dentro del archivo (MP3 y WAV). Si lo dejas sin marcar, la corrección solo vive en Pletina y tu música no se toca.',
        value: state.escribirEtiquetas,
      },
      ok: 'Guardar',
    });
    if (!valores) return;

    const { escribir, ...campos1 } = valores;
    // Con varias canciones, un campo vacío significa «no lo toques».
    const patch = varias
      ? Object.fromEntries(Object.entries(campos1).filter(([, v]) => v !== ''))
      : campos1;
    if (!Object.keys(patch).length && !escribir) return;

    if (escribir !== state.escribirEtiquetas) {
      state.escribirEtiquetas = escribir;
      persist({ escribirEtiquetas: escribir });
    }

    const resultado = await api.track.edit(ids, patch, { escribir });
    await refreshLibrary();
    renderNowPlaying();
    contarEscritura(resultado.archivos, resultado.edited);
  },

  /** Poner una imagen como carátula, con la misma casilla de «escribir o no». */
  async setCover(ids) {
    const resultado = await api.track.cover(ids, { escribir: state.escribirEtiquetas });
    if (resultado.canceled) return;
    if (!resultado.ok) {
      toast(resultado.error ? `No he podido usar esa imagen: ${resultado.error}` : 'No he podido usar esa imagen.');
      return;
    }
    await refreshLibrary();
    renderNowPlaying();
    contarEscritura(resultado.archivos, 0, 'Carátula puesta');
  },

  async clearCover(ids) {
    await api.track.clearCover(ids);
    await refreshLibrary();
    renderNowPlaying();
    toast('Carátula quitada');
  },

  /** Bajar al archivo lo que ya está corregido en Pletina. */
  async writeToFiles(ids) {
    const ok = await dialog({
      title: ids.length > 1 ? `¿Escribir en ${plural(ids.length, 'archivo', 'archivos')}?` : '¿Escribir en el archivo?',
      message: 'Se modifican los archivos de tu disco: se guarda una copia de seguridad al lado de cada uno, con la extensión .pletina-bak. Solo funciona en MP3 y WAV.',
      ok: 'Escribir',
    });
    if (!ok) return;
    const resultado = await api.track.write(ids);
    await refreshLibrary();
    contarEscritura(resultado, 0, 'Nada que escribir');
  },

  async restoreTags(ids) {
    const resultado = await api.track.restore(ids);
    await refreshLibrary();
    renderNowPlaying();
    if (resultado.unavailable) {
      toast('No he podido leer el archivo: la corrección se queda como está.');
      return;
    }
    toast(resultado.restored ? 'Etiquetas del archivo recuperadas' : 'No había nada que deshacer');
  },

  goToAlbum(track) {
    const key = `${normalize(track.albumArtist || track.artist)} ${normalize(track.album || 'Sin álbum')}`;
    if (albumByKey(key)) actions.navigate({ type: 'album', key });
  },

  goToArtist(track) {
    const key = normalize(track.albumArtist || track.artist || 'Sin artista');
    if (artistByKey(key)) actions.navigate({ type: 'artist', key });
  },

  openCard(kind, key) {
    actions.navigate({ type: kind, key });
  },

  playCard(kind, key) {
    const group = kind === 'album' ? albumByKey(key) : artistByKey(key);
    if (!group) return;
    playIds(group.tracks.map((track) => track.id));
  },

  sortBy(key, toggle = false) {
    if (toggle && state.sort.key === key) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
    else state.sort = { key, dir: key === 'added' || key === 'lastPlayed' || key === 'plays' ? 'desc' : 'asc' };
    persist({ sort: state.sort });
    renderStage();
  },

  /** Orden de las rejillas de álbumes y artistas. */
  sortGrid(key, toggle = false) {
    const destino = state.view.type === 'albums' ? 'ordenAlbumes' : 'ordenArtistas';
    if (toggle) state[destino] = { ...state[destino], dir: state[destino].dir === 'asc' ? 'desc' : 'asc' };
    else state[destino] = { key, dir: 'asc' };
    persist({ [destino]: state[destino] });
    renderStage();
  },

  /** Reordena una lista de forma permanente por un criterio. */
  async reorderPlaylistBy(key) {
    const playlist = playlistById(state.view.id);
    if (!playlist) return;
    const canciones = playlist.trackIds.map((id) => getTrack(id)).filter(Boolean);
    const dir = key === 'added' || key === 'plays' || key === 'lastPlayed' ? 'desc' : 'asc';
    const ids = sortTracks(canciones, key, dir, opcionesDeOrden()).map((t) => t.id);
    playlist.trackIds = ids;
    renderStage();
    await api.playlists.update(playlist.id, { trackIds: ids });
    toast('Lista reordenada. Puedes seguir ajustándola arrastrando.');
  },

  /** Todo lo que se pulsa en la pantalla del mezclador pasa por aquí. */
  mezclador(que, valor) {
    switch (que) {
      case 'ahora': {
        const resultado = mezclarAhora();
        if (!resultado.ok) {
          toast(resultado.motivo);
          return;
        }
        toast(`Mezclando · ${resultado.resumen}`);
        refreshRows();
        renderQueue();
        break;
      }
      case 'analizar':
        // Si ya está analizada, el botón dice «Volver a analizar» y tiene que
        // volver a analizarla de verdad: sin forzar contestaba «ya estaba
        // analizada» y no hacía nada, que es la peor manera de tener razón.
        actions.analizar([valor], { forzar: analizada(getTrack(valor)) }).then(() => renderStage());
        return;
      case 'zoom':
        cambiarZoom(Number(valor));
        break;
      case 'preescuchar': {
        const actual = platoB();
        if (!actual) return;
        player.escucharPreparado(!actual.escuchando);
        renderStage();
        return;
      }
      case 'soltar-b':
        soltarPlatoB();
        renderStage();
        return;
      case 'compas-atras':
        saltarCompasesEnB(-1);
        return;
      case 'compas-adelante':
        saltarCompasesEnB(1);
        return;
      case 'poner-uno': {
        ponerElUnoEnB().then((resultado) => {
          if (!resultado.ok) toast(resultado.motivo);
          else {
            toast('Rejilla corregida: el uno queda donde lo has puesto.');
            renderStage();
          }
        });
        return;
      }
      case 'marcar-tempo': {
        // El botón cuenta los golpes en su propia etiqueta y no repinta la
        // pantalla en cada uno: quien marca un tempo da cuatro golpes seguidos
        // y necesita el botón quieto debajo del dedo.
        const boton = document.querySelector('[data-mezcla="marcar-tempo"]');
        marcarTempoEnB().then((resultado) => {
          if (!resultado.ok) return toast(resultado.motivo);
          // La etiqueta del botón lleva la cuenta y el tempo que va saliendo,
          // sin repintar nada: el botón tiene que quedarse quieto bajo el dedo.
          if (boton) {
            boton.lastChild.textContent = resultado.bpm
              ? ` ${Math.round(resultado.bpm)} bpm · ${resultado.golpes} golpes`
              : ` Marcando… ${resultado.golpes}`;
          }
          // Y cuando se deja de marcar, la cabina se entera de una vez.
          clearTimeout(esperandoGolpes);
          esperandoGolpes = setTimeout(() => {
            if (marcandoTempo()) return;
            renderStage();
          }, 2600);
          return undefined;
        });
        return;
      }
      case 'octava': {
        cambiarOctavaEnB(Number(valor)).then((resultado) => {
          if (!resultado.ok) toast(resultado.motivo);
          else {
            toast(`Ahora se cuenta a ${Math.round(resultado.bpm)} pulsaciones.`);
            renderStage();
          }
        });
        return;
      }
      case 'analizar-pendientes': {
        // Todo lo que le falta a la biblioteca, desde la cabina: sin análisis no
        // hay sugerencias ni rejilla, y descubrirlo teniendo que ir a la
        // biblioteca es un viaje de más justo cuando estás pinchando.
        const ids = state.tracks
          .filter((track) => !track.missing && esReproducible(track) && !analizada(track))
          .map((t) => t.id);
        if (ids.length) {
          actions.analizar(ids).then(() => renderStage());
          return;
        }
        // Y si no falta ninguna, se ofrece rehacer la biblioteca entera, que es
        // lo que uno quiere cuando el análisis no le cuadra. Rehacer solo los
        // dos platos dejaba fuera justo lo que hay que arreglar.
        const todas = state.tracks.filter((track) => !track.missing);
        if (!todas.length) return;
        dialog({
          title: `¿Volver a analizar ${plural(todas.length, 'canción', 'canciones')}?`,
          message: 'Ya están todas analizadas. Volver a hacerlo cuesta unos segundos por canción, y se puede parar desde el aviso de arriba.',
          ok: 'Volver a analizar',
        }).then((rehacer) => {
          if (!rehacer) return undefined;
          return actions.analizar(todas.map((t) => t.id), { forzar: true }).then(() => renderStage());
        });
        return;
      }
      case 'compases':
        cambiarAjustes({ compases: Number(valor) });
        break;
      case 'estilo':
        cambiarAjustes({ estilo: String(valor) });
        break;
      case 'ajustarTempo':
      case 'estirarTiempo':
      case 'auto':
        cambiarAjustes({ [que]: Boolean(valor) });
        if (que === 'auto') renderRail();
        break;
      default:
        return;
    }
    persist({ mezclador: state.mezclador });
    renderStage();
  },

  /** Cargar una canción en el plato B: es la manera de ir más allá de la cola. */
  /**
   * El buscador del plato B.
   *
   * Se vuelve a pintar en cada tecla, así que hay que devolverle el foco: sin
   * esto se escribe una letra y el cursor se cae del campo.
   */
  buscarCandidato(texto, campoViejo) {
    // Se guarda dónde estaba el cursor y se devuelve ahí. Mandarlo al final
    // hacía imposible corregir una letra en medio de la palabra, y rompía las
    // teclas muertas de las tildes, que en castellano es escribir normal.
    const inicio = campoViejo?.selectionStart ?? null;
    const fin = campoViejo?.selectionEnd ?? null;
    buscarParaPlatoB(texto);
    renderStage();
    const campo = document.querySelector('[data-buscar-candidato]');
    if (!campo) return;
    campo.focus();
    if (inicio != null) campo.setSelectionRange(inicio, fin ?? inicio);
    else campo.setSelectionRange(campo.value.length, campo.value.length);
  },
  cargarEnPlatoB(id) {
    const resultado = cargarEnPlatoB(id);
    if (!resultado.ok) {
      toast(resultado.motivo);
      return;
    }
    toast(`«${resultado.ficha.titulo}» esperando en el plato B`);
    renderStage();
    renderQueue();
  },

  /** Saltar dentro de una onda general: en A suena, en B solo se coloca. */
  saltar(cual, segundo) {
    if (cual === 'b') player.moverPreparado(segundo);
    else player.seekTo(segundo);
  },

  /** Empujar un plato arrastrando su onda, como se empuja un vinilo. */
  empujar(cual, segundos) {
    player.empujar(segundos, { plato: cual === 'b' ? 'preparado' : 'activo' });
  },

  selectionChanged() {
    refreshRows();
    renderStageHead();
  },

  async moveInPlaylist(id, delta) {
    if (!canReorder()) return;
    const playlist = playlistById(state.view.id);
    if (!playlist) return;
    const ids = playlist.trackIds.slice();
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    playlist.trackIds = ids;
    renderStage();
    $(`.row[data-id="${CSS.escape(id)}"]`)?.focus();
    await api.playlists.update(playlist.id, { trackIds: ids });
    renderRail();
  },

  async reorderInPlaylist(draggedId, targetId, after) {
    if (!canReorder() || draggedId === targetId) return;
    const playlist = playlistById(state.view.id);
    if (!playlist) return;
    const ids = playlist.trackIds.filter((id) => id !== draggedId);
    const at = ids.indexOf(targetId);
    ids.splice(after ? at + 1 : at, 0, draggedId);
    playlist.trackIds = ids;
    renderStage();
    await api.playlists.update(playlist.id, { trackIds: ids });
  },

  async tool(name, element) {
    const tracks = visibleTracks();
    switch (name) {
      case 'play-all':
        if (!tracks.length) return;
        if (state.shuffle) setShuffle(false);
        playIds(tracks.map((track) => track.id));
        break;
      case 'shuffle-all': {
        if (!tracks.length) return;
        state.shuffle = true;
        persist({ shuffle: true });
        syncToggles(appInfo);
        state.queue = createQueue(tracks.map((track) => track.id), { shuffled: true });
        loadAndPlay(state.queue.order[0]);
        break;
      }
      case 'dir':
        state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
        persist({ sort: state.sort });
        renderStage();
        break;
      case 'grid-dir':
        actions.sortGrid(null, true);
        break;
      case 'back':
        actions.navigate({ type: state.view.type === 'album' ? 'albums' : 'artists' });
        break;
      case 'add-folder':
        await api.library.addFolders();
        break;
      case 'add-files':
        await api.library.addFiles();
        break;
      case 'go-library':
        actions.navigate({ type: 'library' });
        break;
      case 'clear-q':
        $('#q').value = '';
        setQuery('');
        renderStage();
        break;
      case 'rescan':
        api.library.rescan();
        break;
      case 'analizar': {
        // Lo seleccionado si hay selección; si no, todo lo que se está viendo.
        const objetivo = state.selection.size > 1
          ? tracks.filter((track) => state.selection.has(track.id))
          : tracks;
        if (!objetivo.length) return;
        const faltan = objetivo.filter((track) => !analizada(track));
        if (!faltan.length) {
          const rehacer = await dialog({
            title: `¿Volver a analizar ${plural(objetivo.length, 'canción', 'canciones')}?`,
            message: 'Ya están todas analizadas. Volver a hacerlo cuesta unos segundos por canción y solo hace falta si el resultado no cuadra.',
            ok: 'Volver a analizar',
          });
          if (!rehacer) return;
        }
        await actions.analizar(objetivo.map((track) => track.id), { forzar: !faltan.length });
        renderStage();
        break;
      }
      case 'drop-missing': {
        const ok = await dialog({
          title: '¿Quitar las canciones que ya no están?',
          message: 'Se borran de la biblioteca y de las listas. Si el disco vuelve a conectarse, se pueden añadir otra vez.',
          ok: 'Quitar',
          danger: true,
        });
        if (!ok) return;
        const result = await api.library.removeMissing();
        actions.navigate({ type: 'library' });
        await refreshLibrary();
        toast(`${plural(result.removed, 'canción quitada', 'canciones quitadas')}`);
        break;
      }
      case 'pl-rename': {
        const playlist = playlistById(state.view.id);
        if (!playlist) return;
        const name = await dialog({ title: 'Renombrar lista', input: 'Nombre', value: playlist.name, ok: 'Guardar' });
        if (!name) return;
        await api.playlists.update(playlist.id, { name });
        await refreshLibrary();
        break;
      }
      case 'pl-export': {
        const result = await api.playlists.exportFile(state.view.id);
        if (result?.ok) toast('Lista exportada');
        break;
      }
      case 'pl-delete': {
        const playlist = playlistById(state.view.id);
        if (!playlist) return;
        const ok = await dialog({
          title: `¿Eliminar «${playlist.name}»?`,
          message: 'Se borra la lista. Las canciones siguen en tu biblioteca.',
          ok: 'Eliminar',
          danger: true,
        });
        if (!ok) return;
        await api.playlists.remove(playlist.id);
        state.view = { type: 'library', id: null };
        await refreshLibrary({ keepScroll: false });
        toast('Lista eliminada');
        break;
      }
      case 'sel-next':
        actions.enqueueNext([...state.selection]);
        break;
      case 'sel-playlist':
        actions.addToPlaylistMenu(element, [...state.selection]);
        break;
      case 'sel-clear':
        clearSelection();
        actions.selectionChanged();
        break;
      default:
        break;
    }
  },

  addToPlaylistMenu(anchor, ids) {
    popover(anchor, [
      { type: 'cap', label: 'Añadir a una lista' },
      ...state.playlists.map((playlist) => ({
        key: playlist.id,
        label: playlist.name,
        run: () => actions.addToPlaylist(playlist.id, ids),
      })),
      { key: 'new', label: 'Nueva lista…', run: () => withPlaylistPrompt(ids) },
    ]);
  },
};

/* --------------------------------------------------------- raíl y cola */

const railActions = {
  navigate: actions.navigate,
  addToPlaylist: actions.addToPlaylist,
  reorderPlaylists: async (ids) => {
    state.playlists = ids.map((id) => playlistById(id)).filter(Boolean);
    renderRail();
    await api.playlists.reorder(ids);
  },
  newPlaylist: () => withPlaylistPrompt([]),
  addFolder: () => api.library.addFolders(),
  async removeFolder(folderPath) {
    const ok = await dialog({
      title: '¿Quitar esta carpeta?',
      message: `${folderPath}\n\nSus canciones salen de la biblioteca. Los archivos no se tocan.`,
      ok: 'Quitar',
      danger: true,
    });
    if (!ok) return;
    await api.library.removeFolder(folderPath);
    await refreshLibrary({ keepScroll: false });
    toast('Carpeta quitada de la biblioteca');
  },
  playlistMenu(anchor, id) {
    playlistMenu(anchor, id, {
      play: (playlist) => playIds(playlist.trackIds),
      shuffle: (playlist) => {
        setShuffle(true);
        playIds(playlist.trackIds);
      },
      rename: async (playlist) => {
        const name = await dialog({ title: 'Renombrar lista', input: 'Nombre', value: playlist.name, ok: 'Guardar' });
        if (!name) return;
        await api.playlists.update(playlist.id, { name });
        await refreshLibrary();
      },
      exportFile: async (playlist) => {
        const result = await api.playlists.exportFile(playlist.id);
        if (result?.ok) toast('Lista exportada');
      },
      remove: async (playlist) => {
        const ok = await dialog({
          title: `¿Eliminar «${playlist.name}»?`,
          message: 'Se borra la lista. Las canciones siguen en tu biblioteca.',
          ok: 'Eliminar',
          danger: true,
        });
        if (!ok) return;
        await api.playlists.remove(playlist.id);
        if (state.view.id === playlist.id) state.view = { type: 'library', id: null };
        await refreshLibrary({ keepScroll: false });
      },
    });
  },
};

const queueActions = {
  close() {
    state.queueOpen = false;
    persist({ queueOpen: false });
    syncToggles(appInfo);
    renderQueue();
  },
  clearManual() {
    state.queue = { ...state.queue, manual: [] };
    renderQueue();
  },
  /** Una sesión de escucha bien armada merece quedarse. */
  saveAsPlaylist() {
    const { queue } = state;
    const ids = [...new Set([
      ...(state.currentId ? [state.currentId] : []),
      ...queue.manual,
      ...queue.order.slice(queue.index + 1),
    ])].filter((id) => state.byId.has(id));
    if (!ids.length) {
      toast('La cola está vacía.');
      return;
    }
    withPlaylistPrompt(ids);
  },
  dropManual(index) {
    state.queue = dropManual(state.queue, index);
    renderQueue();
  },
  jump(index) {
    state.queue = { ...state.queue, index };
    loadAndPlay(state.queue.order[index]);
  },
};

const sonidoActions = {
  cambiarEq(cambio) {
    state.eq = { ...state.eq, ...cambio };
    player.aplicarEcualizador(state.eq);
    persist({ eq: state.eq });
    syncToggles(appInfo);
  },
  cambiarFundido(segundos) {
    state.crossfade = segundos;
    persist({ crossfade: segundos });
  },
  cambiarAutomezcla(activada) {
    // Un solo interruptor: el del mezclador. Antes había dos y nadie sabía cuál
    // mandaba.
    cambiarAjustes({ auto: activada });
    persist({ mezclador: state.mezclador });
    renderRail();
    if (state.view.type === 'mezclador') renderStage();
  },
  cambiarTempo(cambio) {
    const actual = player.tempoActual();
    const nuevo = player.ajustarVelocidad(
      cambio.velocidad ?? actual.velocidad,
      cambio.preservarTono ?? actual.preservarTono,
    );
    renderNowPlaying();
    return nuevo;
  },
  cambiarNormalizar(activada) {
    state.normalize = activada;
    player.applyVolume();
    persist({ normalize: activada });
  },
};

const transportActions = {
  tempo: () => player.tempoActual(),
  toggle: togglePlay,
  next: () => next(false),
  prev,
  duration: () => player.duration(),
  seekTo: (seconds) => player.seekTo(seconds),
  toggleShuffle: () => setShuffle(!state.shuffle),
  cycleRepeat() {
    state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
    persist({ repeat: state.repeat });
    syncToggles(appInfo);
    toast(state.repeat === 'off' ? 'Repetición desactivada' : state.repeat === 'all' ? 'Repetir toda la lista' : 'Repetir esta canción');
  },
  toggleMute() {
    state.muted = !state.muted;
    player.applyVolume();
    persist({ muted: state.muted });
    syncToggles(appInfo);
  },
  setVolume(value) {
    state.volume = value;
    if (state.muted && value > 0) state.muted = false;
    player.applyVolume();
    persist({ volume: value, muted: state.muted });
    syncToggles(appInfo);
  },
  toggleFavorite() {
    if (!state.currentId) return;
    actions.setFavorite([state.currentId], !getTrack(state.currentId)?.favorite);
  },
  toggleQueue() {
    state.queueOpen = !state.queueOpen;
    persist({ queueOpen: state.queueOpen });
    syncToggles(appInfo);
    renderQueue();
  },
  abrirSonido: (ancla) => abrirSonido(ancla),
  toggleTheme() {
    const theme = appInfo.dark ? 'light' : 'dark';
    appInfo.dark = !appInfo.dark;
    document.documentElement.dataset.theme = theme;
    persist({ theme });
    syncToggles(appInfo);
  },
  help: (anchor) => helpPopover(anchor, appInfo, popover),
};

/* -------------------------------------------------------------- teclado */

/**
 * Atajos con Ctrl o Cmd, los mismos que enseña el menú.
 *
 * Viven aquí y no solo en el menú porque el menú no está a la vista en Windows
 * y sus aceleradores dependen del sistema; el menú los muestra, esta tabla los
 * hace funcionar. Los del menú están marcados para no registrarse dos veces.
 */
const ATAJOS = new Map([
  ['f', 'focus:search'],
  ['p', 'play:toggle'],
  ['ArrowRight', 'play:next'],
  ['ArrowLeft', 'play:prev'],
  ['ArrowUp', 'volume:up'],
  ['ArrowDown', 'volume:down'],
  ['m', 'volume:mute'],
  ['s', 'toggle:shuffle'],
  ['r', 'toggle:repeat'],
  ['u', 'toggle:queue'],
  ['1', 'view:library'],
  ['2', 'view:albums'],
  ['3', 'view:artists'],
  ['4', 'view:favorites'],
  ['5', 'view:recent'],
  ['6', 'view:mezclador'],
  ['e', 'abrir:sonido'],
  ['/', 'help:shortcuts'],
  ['alt+ArrowRight', 'seek:forward'],
  ['alt+ArrowLeft', 'seek:back'],
]);

/**
 * ¿Está el usuario escribiendo?
 *
 * Solo cuenta lo que se escribe: una casilla, un desplegable o un deslizador no
 * son escribir. La versión de antes daba por escritura cualquier `input`, y eso
 * dejaba media aplicación sin teclado: mueves el volumen o un mando del
 * ecualizador con el ratón, el foco se queda ahí, y a partir de ese momento no
 * responde ni el espacio. La tecla no estaba rota; estaba secuestrada.
 *
 * Y `matches` con interrogación porque no todo lo que recibe una tecla es un
 * elemento —el documento también, y ahí no existe—: sin eso, el manejador
 * reventaba antes de mirar la tecla y no funcionaba ninguna.
 */
function escribiendo(elemento) {
  if (!elemento) return false;
  if (elemento.isContentEditable) return true;
  if (elemento.matches?.('textarea')) return true;
  if (!elemento.matches?.('input')) return false;
  return !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color'].includes(elemento.type);
}

/**
 * Teclas que un mando con el foco usa para lo suyo: ahí manda el navegador.
 *
 * Las flechas de un deslizador lo mueven y el espacio marca una casilla, y eso
 * es lo único con lo que se puede usar la aplicación sin ratón. Quitárselo para
 * ganar un atajo global sería cambiar un teclado que funciona por otro.
 */
const DEL_MANDO = new Set([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
const MANDOS = 'input[type="range"], input[type="checkbox"], input[type="radio"], select';

function onKeyDown(event) {
  if (isDialogOpen()) return;
  const target = event.target;
  if (escribiendo(target)) {
    if (event.key === 'Escape' && target.id === 'q') {
      target.value = '';
      setQuery('');
      renderStage();
      target.blur();
    }
    return;
  }
  // Un mando con el foco se queda con sus teclas —moverlo es para lo que está—,
  // pero no con todas las demás.
  const enMando = target?.matches?.(MANDOS);
  if (enMando && !event.ctrlKey && !event.metaKey && DEL_MANDO.has(event.key)) return;

  const mod = event.metaKey || event.ctrlKey;
  if (mod && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    state.selection = new Set(visibleTracks().map((track) => track.id));
    actions.selectionChanged();
    return;
  }
  if (mod) {
    // Los atajos del menú, atendidos también aquí.
    //
    // En Windows la barra de menú no se ve —la barra de título la dibuja la
    // aplicación— y los aceleradores del menú son un sitio raro donde vivir:
    // dependen de que el sistema los reparta. Atendiéndolos aquí funcionan
    // siempre y en todos los sistemas, y el menú los sigue enseñando.
    const orden = ATAJOS.get(event.altKey ? `alt+${event.key}` : event.key)
      ?? ATAJOS.get(event.key.toLowerCase());
    if (orden) {
      event.preventDefault();
      onCommand({ name: orden });
    }
    return;
  }
  if (!mod && event.altKey) {
    const orden = ATAJOS.get(`alt+${event.key}`);
    if (orden) {
      event.preventDefault();
      onCommand({ name: orden });
    }
    return;
  }
  if (target?.closest?.('button') && (event.key === ' ' || event.key === 'Enter')) return;

  switch (event.key) {
    case ' ':
      event.preventDefault();
      togglePlay();
      break;
    case 'ArrowRight':
      player.seekBy(5);
      break;
    case 'ArrowLeft':
      player.seekBy(-5);
      break;
    case 'ArrowUp':
      event.preventDefault();
      transportActions.setVolume(Math.min(1, state.volume + 0.05));
      break;
    case 'ArrowDown':
      event.preventDefault();
      transportActions.setVolume(Math.max(0, state.volume - 0.05));
      break;
    case 'n':
    case 'N':
      next(false);
      break;
    case 'p':
    case 'P':
      prev();
      break;
    case 's':
    case 'S':
      setShuffle(!state.shuffle);
      break;
    case 'r':
    case 'R':
      transportActions.cycleRepeat();
      break;
    case 'q':
    case 'Q':
      transportActions.toggleQueue();
      break;
    case 'f':
    case 'F':
      transportActions.toggleFavorite();
      break;
    case 'g':
    case 'G':
      scrollToCurrent();
      break;
    // La tecla de la cabina: lanzar la mezcla sin soltar el ratón.
    case 'm':
    case 'M': {
      const resultado = mezclarAhora();
      if (!resultado.ok) toast(resultado.motivo);
      else {
        toast(`Mezclando · ${resultado.resumen}`);
        refreshRows();
        renderQueue();
        if (state.view.type === 'mezclador') renderStage();
      }
      break;
    }
    // Y empujar el plato que suena, como el dedo en el vinilo.
    case ',':
      player.empujar(-0.02);
      break;
    case '.':
      player.empujar(0.02);
      break;
    // En la cabina, el plato preparado se mueve por compases sin tocar el
    // ratón: es lo que se hace mientras se escucha, y con el ratón no se puede
    // hacer y escuchar a la vez.
    case '[':
      if (state.view.type === 'mezclador') saltarCompasesEnB(-1);
      break;
    case ']':
      if (state.view.type === 'mezclador') saltarCompasesEnB(1);
      break;
    // Marcar el tempo a mano, con la tecla: se dan cuatro golpecitos al ritmo
    // de la canción y ya tiene tempo, acierte o no el análisis.
    case 't':
    case 'T': {
      if (state.view.type !== 'mezclador') break;
      actions.mezclador('marcar-tempo');
      break;
    }
    case 'b':
    case 'B': {
      if (state.view.type !== 'mezclador') break;
      const preparado = platoB();
      if (!preparado) toast('No hay nada preparado en el plato B.');
      else {
        player.escucharPreparado(!preparado.escuchando);
        renderStage();
      }
      break;
    }
    case '/':
      event.preventDefault();
      $('#q').focus();
      break;
    case 'Delete':
    case 'Backspace':
      if (state.selection.size) {
        event.preventDefault();
        const ids = [...state.selection];
        if (state.view.type === 'playlist') actions.removeFromPlaylist(ids);
        else actions.forget(ids);
      }
      break;
    case 'Escape':
      closePop();
      cerrarSonido();
      if (state.selection.size) {
        clearSelection();
        actions.selectionChanged();
      }
      break;
    default:
      break;
  }
}

/* ------------------------------------------------------- órdenes del menú */

function onCommand(payload) {
  const { name, paths } = payload;
  switch (name) {
    case 'play:toggle': togglePlay(); break;
    case 'play:next': next(false); break;
    case 'play:prev': prev(); break;
    case 'play:pause': player.pause(); break;
    case 'play:stop': player.pause(); player.seekTo(0); break;
    case 'seek:forward': player.seekBy(10); break;
    case 'seek:back': player.seekBy(-10); break;
    case 'volume:up': transportActions.setVolume(Math.min(1, state.volume + 0.05)); break;
    case 'volume:down': transportActions.setVolume(Math.max(0, state.volume - 0.05)); break;
    case 'volume:mute': transportActions.toggleMute(); break;
    case 'toggle:shuffle': setShuffle(!state.shuffle); break;
    case 'toggle:repeat': transportActions.cycleRepeat(); break;
    case 'toggle:queue': transportActions.toggleQueue(); break;
    case 'toggle:visualizador': {
      const activo = alternarVisualizador(!state.visualizador);
      persist({ visualizador: activo });
      syncToggles(appInfo);
      if (!activo) toast('Visualizador apagado');
      else if (!player.hayMotor()) toast('Este equipo no permite el visualizador.');
      break;
    }
    case 'view:mezclador':
      actions.navigate({ type: 'mezclador' });
      break;
    case 'mezclar:ahora':
      actions.mezclador('ahora');
      break;
    case 'abrir:sonido':
      abrirSonido($('#btn-sonido'));
      break;
    case 'toggle:articulos':
      state.ignorarArticulos = !state.ignorarArticulos;
      persist({ ignorarArticulos: state.ignorarArticulos });
      renderStage();
      toast(state.ignorarArticulos
        ? 'Al ordenar, «Los Planetas» va por la P'
        : 'Al ordenar, «Los Planetas» va por la L');
      break;
    case 'toggle:normalize':
      state.normalize = !state.normalize;
      player.applyVolume();
      persist({ normalize: state.normalize });
      toast(state.normalize ? 'Volumen constante activado' : 'Volumen constante desactivado');
      break;
    case 'sleep:set': programarTemporizador(payload?.minutos ?? 0); break;
    case 'focus:search': $('#q').focus(); break;
    case 'view:library': actions.navigate({ type: 'library' }); break;
    case 'view:albums': actions.navigate({ type: 'albums' }); break;
    case 'view:artists': actions.navigate({ type: 'artists' }); break;
    case 'view:favorites': actions.navigate({ type: 'favorites' }); break;
    case 'view:recent': actions.navigate({ type: 'recent' }); break;
    case 'help:shortcuts': helpPopover($('#btn-help'), appInfo, popover); break;
    case 'help:about': helpPopover($('#btn-help'), appInfo, popover); break;
    case 'playlist:export':
      if (state.view.type === 'playlist') actions.tool('pl-export');
      else toast('Abre primero una lista para exportarla.');
      break;
    case 'play:paths': {
      // «Abrir con Pletina»: la ruta ya está en la biblioteca cuando llega aquí.
      refreshLibrary({ keepScroll: false }).then(() => {
        const wanted = new Set((paths || []).map((p) => p.replace(/\\/g, '/')));
        const found = state.tracks.filter((track) => wanted.has(track.path.replace(/\\/g, '/')));
        if (found.length) playIds(found.map((track) => track.id));
      });
      break;
    }
    default:
      break;
  }
}

/* ------------------------------------------------------------- progreso */

function showProgress(payload) {
  const chip = $('#chip');
  const text = $('#chip-text');
  if (payload.phase === 'fin') {
    chip.classList.remove('show');
    state.scan = null;
    return;
  }
  state.scan = payload;
  chip.classList.add('show');
  if (payload.phase === 'buscando') text.textContent = `Buscando música… ${payload.found || 0}`;
  else text.textContent = `Leyendo ${payload.done}/${payload.total}`;
}

/* --------------------------------------------------------- arrastrar aquí */

function bindDrop() {
  const dropEl = $('#drop');
  let depth = 0;
  const tiposDe = (dt) => Array.from(dt?.types || []);
  /** Un arrastre nuestro (filas hacia una lista) no es una importación. */
  const esInterno = (dt) => tiposDe(dt).includes('application/x-pletina-tracks');
  /** Para el cartel: durante el arrastre el navegador solo promete «Files». */
  const traeArchivos = (dt) => tiposDe(dt).includes('Files');

  window.addEventListener('dragenter', (event) => {
    if (esInterno(event.dataTransfer) || !traeArchivos(event.dataTransfer)) return;
    depth += 1;
    dropEl.classList.add('show');
  });
  window.addEventListener('dragover', (event) => {
    // Sin este preventDefault el navegador se queda el arrastre y el `drop`
    // no llega nunca. Se hace para todo lo que no sea un arrastre nuestro:
    // condicionarlo a `types` deja la función a merced de cómo el sistema
    // rellene esa lista, y ahí es donde se rompía.
    if (esInterno(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (event) => {
    if (esInterno(event.dataTransfer) || !traeArchivos(event.dataTransfer)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) dropEl.classList.remove('show');
  });
  window.addEventListener('drop', async (event) => {
    if (esInterno(event.dataTransfer)) return;
    depth = 0;
    dropEl.classList.remove('show');
    // El `FileList` se esparce AQUÍ: al otro lado del puente de contextos
    // llegaría como un proxy sin iterador y sin una sola ruta dentro.
    const archivos = [...(event.dataTransfer?.files ?? [])];
    // Sin archivos no era una importación —arrastrar texto al buscador, por
    // ejemplo—: se deja pasar en vez de tragarse el evento.
    if (!archivos.length) return;
    event.preventDefault();
    const paths = api.pathsFromDrop(archivos);
    if (!paths.length) {
      toast('No he podido leer lo que has soltado.');
      return;
    }
    const summary = await api.library.addPaths(paths);
    if (!summary.added) toast('No he encontrado música nueva ahí.');
  });
}

/* --------------------------------------------------------------- arranque */

async function boot() {
  document.documentElement.dataset.platform = api.platform;

  const [settings, info] = await Promise.all([api.settings.get(), api.app.info()]);
  appInfo = info;
  document.documentElement.dataset.theme = info.dark ? 'dark' : 'light';

  Object.assign(state, {
    volume: settings.volume ?? 0.9,
    muted: Boolean(settings.muted),
    shuffle: Boolean(settings.shuffle),
    repeat: settings.repeat ?? 'off',
    normalize: Boolean(settings.normalize),
    escribirEtiquetas: Boolean(settings.escribirEtiquetas),
    queueOpen: Boolean(settings.queueOpen),
    visualizador: Boolean(settings.visualizador),
    sort: settings.sort ?? { key: 'added', dir: 'desc' },
    eq: settings.eq ?? { activado: false, preset: 'plano', bandas: new Array(10).fill(0), preamp: 0 },
    crossfade: Number(settings.crossfade) || 0,
    view: settings.view ?? { type: 'library', id: null },
    mezclador: { ...state.mezclador, ...(settings.mezclador ?? {}) },
    ordenAlbumes: settings.ordenAlbumes ?? { key: 'artista', dir: 'asc' },
    ordenArtistas: settings.ordenArtistas ?? { key: 'nombre', dir: 'asc' },
    ignorarArticulos: settings.ignorarArticulos !== false,
  });

  bindRail(railActions);
  bindStage(actions);
  bindCabina(actions);
  bindQueue(queueActions);
  bindTransport(transportActions);
  bindDrop();
  bindSonido(sonidoActions);
  montarVisualizador(player.engine());

  player.onPlayer({
    onEnded: () => next(true),
    onError: () => setTimeout(() => next(true), 900),
    onTrack: () => renderNowPlaying(),
    onPlayState: () => {
      renderPlayState();
      refreshRows();
    },
    onTick: (current, total) => {
      tick(current, total);
      // Una escucha cuenta a los quince segundos, no por abrir el archivo.
      if (current > 15 && countedFor !== state.currentId) {
        countedFor = state.currentId;
        const track = getTrack(state.currentId);
        if (track) {
          track.playCount = (track.playCount || 0) + 1;
          track.lastPlayedAt = Date.now();
          api.track.played(state.currentId);
        }
      }
    },
    onPositionSave: (trackId, position) => {
      if (trackId) persist({ last: { trackId, position } });
    },
    // El fundido se desactiva con el temporizador «al terminar esta canción»:
    // encadenar sería justo lo contrario de lo que se ha pedido.
    margenDeFundido: () => {
      if (dormir.alTerminar) return 0;
      // El mezclador necesita más margen que un fundido: una transición de
      // ocho compases a 120 son dieciséis segundos.
      const automatico = margenAutomatico();
      return automatico || state.crossfade;
    },
    onCercaDelFinal: encadenarSiguiente,
    // El mezclador se entera por aquí de que su transición ha terminado o se ha
    // cortado: antes lo adivinaba con un temporizador y la pantalla se quedaba
    // mezclando después de darle a siguiente.
    onMezcla: ({ en }) => {
      if (en !== 'fin') return;
      terminarMezcla();
      if (state.view.type === 'mezclador') renderStage();
    },
  });
  player.bindMediaSession({ next: () => next(false), prev });
  player.applyVolume();
  player.aplicarEcualizador(state.eq);

  await refreshLibrary({ keepScroll: false });
  if (state.visualizador) alternarVisualizador(true);
  syncToggles(appInfo);
  renderPlayState();
  renderNowPlaying();

  // Se recupera lo último que sonaba, en pausa y donde se quedó.
  const last = settings.last;
  if (last?.trackId && state.byId.has(last.trackId)) {
    state.queue = createQueue(visibleTracks().map((track) => track.id), {
      startId: last.trackId,
      shuffled: state.shuffle,
    });
    loadAndPlay(last.trackId, { play: false, position: last.position || 0 });
  }

  let searchTimer = 0;
  $('#q').addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    const value = event.target.value;
    searchTimer = setTimeout(() => {
      setQuery(value.trim());
      clearSelection();
      renderStage();
    }, 110);
  });
  $('#add-btn').addEventListener('click', (event) => {
    popover(event.currentTarget, [
      { key: 'folder', label: 'Añadir una carpeta…', run: () => api.library.addFolders() },
      { key: 'files', label: 'Añadir archivos sueltos…', run: () => api.library.addFiles() },
      { type: 'sep' },
      { key: 'm3u', label: 'Importar una lista M3U…', run: () => api.playlists.importFile() },
      { key: 'rescan', label: 'Analizar la biblioteca de nuevo', run: () => api.library.rescan() },
    ]);
  });
  $('#chip-stop').addEventListener('click', () => {
    // El mismo botón para las dos esperas largas que hay: leer la carpeta y
    // analizar. Manda la que esté en marcha.
    if (analizandoLote()) cancelarLote();
    else api.library.stopScan();
  });
  $('#sleep').addEventListener('click', () => cancelarTemporizador({ avisar: true }));
  $('#btn-menu').addEventListener('click', (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    api.app.menu(rect.left, rect.bottom);
  });
  document.addEventListener('keydown', onKeyDown);
  // Un botón pulsado con el ratón se queda con el foco, y a partir de ahí el
  // espacio deja de ser «pausa» para ser «vuelve a pulsar ese botón». Se le
  // quita el foco cuando el clic viene del ratón —`detail` lo dice— y se le
  // deja cuando viene del teclado, que ahí sí hace falta.
  document.addEventListener('click', (event) => {
    if (!event.detail) return;
    const boton = event.target?.closest?.('button');
    if (boton && document.activeElement === boton) boton.blur();
  });
  window.addEventListener('beforeunload', () => {
    if (state.currentId) persist({ last: { trackId: state.currentId, position: player.currentTime() } });
    persist({ view: state.view });
  });

  alCambiarMezclador(() => {
    if (state.view.type === 'mezclador') renderStage();
  });

  api.on.command(onCommand);
  api.on.libraryProgress(showProgress);
  api.on.libraryChanged(async ({ reason, summary }) => {
    await refreshLibrary();
    if (summary?.added) toast(`${plural(summary.added, 'canción añadida', 'canciones añadidas')}`);
    else if (reason === 'add-folder' || reason === 'drop') toast('No he encontrado música nueva ahí.');
    if (summary?.unavailable?.length) {
      toast('Hay carpetas que no se pueden leer ahora mismo. ¿Disco desconectado?');
    }
  });
  api.on.libraryWarning(({ message }) => {
    $('#warn-slot').innerHTML = `<div class="warn">${esc(message)}</div>`;
  });
  api.on.themeChanged(({ dark }) => {
    appInfo.dark = dark;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    syncToggles(appInfo);
  });

  state.ready = true;
}

boot().catch((error) => {
  document.body.innerHTML = `<div class="empty" style="margin:60px auto"><h3>Pletina no ha podido arrancar</h3>
    <p>${esc(error.message)}</p></div>`;
});
