/**
 * Leer la colección de rekordbox.
 *
 * Quien lleva años pinchando tiene su trabajo hecho: rejillas corregidas a
 * mano, el «uno» colocado a ojo canción por canción y los puntos de referencia
 * puestos donde entra cada tema. Pedirle que lo repita es pedirle que no use
 * esto. Su `collection.xml` lo tiene todo y es un fichero de texto.
 *
 * No se usa un analizador de XML de verdad a propósito: el formato es plano
 * —elementos con atributos y nada más—, la dependencia sería un árbol entero
 * para leer cuatro campos, y el fichero viene de fuera, así que lo que hace
 * falta es un lector acotado que no se atragante y no ejecute nada. Aquí no se
 * resuelven entidades externas ni DOCTYPE: se saltan.
 *
 * Lo que sale de aquí son datos; quien decide qué se guarda es el que llama.
 */

/** Ni una colección de discoteca pasa de esto. Es un tope, no una expectativa. */
const MAXIMO_PISTAS = 100000;
/** Puntos de referencia que tiene Pletina. rekordbox tiene ocho. */
export const CUES_POR_PISTA = 4;

const ENTIDADES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#34': '"',
};

/** Sustituye las entidades que usa rekordbox. Las numéricas, en decimal y hexa. */
function desescapar(texto) {
  if (!texto.includes('&')) return texto;
  return texto.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (entera, nombre) => {
    if (nombre[0] === '#') {
      const codigo = nombre[1] === 'x' || nombre[1] === 'X'
        ? parseInt(nombre.slice(2), 16)
        : parseInt(nombre.slice(1), 10);
      return Number.isFinite(codigo) && codigo > 0 && codigo <= 0x10ffff
        ? String.fromCodePoint(codigo)
        : entera;
    }
    return ENTIDADES[nombre] ?? entera;
  });
}

/**
 * Recorre el documento y va soltando etiquetas: `{ nombre, atributos, cierra,
 * sola }`. Se salta comentarios, CDATA, instrucciones y DOCTYPE sin mirarlos.
 */
function* etiquetas(xml) {
  let i = 0;
  const largo = xml.length;
  while (i < largo) {
    const abre = xml.indexOf('<', i);
    if (abre === -1) return;
    if (xml.startsWith('<!--', abre)) {
      const fin = xml.indexOf('-->', abre + 4);
      i = fin === -1 ? largo : fin + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', abre)) {
      const fin = xml.indexOf(']]>', abre + 9);
      i = fin === -1 ? largo : fin + 3;
      continue;
    }
    if (xml.startsWith('<?', abre) || xml.startsWith('<!', abre)) {
      const fin = xml.indexOf('>', abre + 2);
      i = fin === -1 ? largo : fin + 1;
      continue;
    }
    const cierre = xml.indexOf('>', abre + 1);
    if (cierre === -1) return;
    const cuerpo = xml.slice(abre + 1, cierre);
    i = cierre + 1;
    const cierra = cuerpo[0] === '/';
    const sola = cuerpo.endsWith('/');
    const limpio = cuerpo.replace(/^\//, '').replace(/\/$/, '');
    const espacio = limpio.search(/\s/);
    const nombre = (espacio === -1 ? limpio : limpio.slice(0, espacio)).toUpperCase();
    if (!nombre) continue;
    const atributos = {};
    if (!cierra && espacio !== -1) {
      const resto = limpio.slice(espacio);
      const busca = /([\w:-]+)\s*=\s*"([^"]*)"|([\w:-]+)\s*=\s*'([^']*)'/g;
      let par = busca.exec(resto);
      while (par) {
        atributos[par[1] ?? par[3]] = desescapar(par[2] ?? par[4] ?? '');
        par = busca.exec(resto);
      }
    }
    yield { nombre, atributos, cierra, sola };
  }
}

/**
 * La ruta real de un `Location` de rekordbox.
 *
 * Viene como URI de archivo y con todo escapado: acentos, espacios y el signo
 * de porcentaje. En Windows además lleva la unidad detrás de una barra que hay
 * que quitar, o la ruta empieza por `/C:` y no existe.
 */
export function rutaDeLocation(location) {
  if (typeof location !== 'string' || !location) return '';
  let ruta = location.replace(/^file:\/\/(localhost)?/i, '');
  try {
    ruta = decodeURIComponent(ruta);
  } catch {
    // Un porcentaje suelto en el nombre rompe el descodificador: mejor la ruta
    // tal cual que ninguna, que quizá empareje igual por el nombre del archivo.
  }
  if (/^\/[A-Za-z]:/.test(ruta)) ruta = ruta.slice(1);
  return ruta;
}

const numero = (valor) => {
  const v = Number.parseFloat(valor);
  return Number.isFinite(v) ? v : null;
};

/**
 * La rejilla de una pista, a partir de su primer `TEMPO`.
 *
 * `Inizio` es el instante de un golpe y `Battito` cuál de los cuatro tiempos
 * del compás es ese golpe. De ahí salen las dos cosas que hacen falta: el
 * desfase de la rejilla y en qué tiempo cae el «uno».
 *
 * Con varios `TEMPO` la canción tiene un tempo por tramo, que es más de lo que
 * Pletina sabe guardar. Se coge el primero y se dice, que es mejor que fingir.
 */
export function rejillaDeTempos(tempos, bpmMedio) {
  const primero = tempos[0];
  const bpm = numero(primero?.Bpm) || bpmMedio;
  if (!(bpm > 0)) return null;
  const periodo = 60 / bpm;
  const inicio = Math.max(0, numero(primero?.Inizio) ?? 0);
  const offset = ((inicio % periodo) + periodo) % periodo;
  const golpes = Math.round((inicio - offset) / periodo);
  const battito = Math.min(4, Math.max(1, Math.round(numero(primero?.Battito) ?? 1)));
  const tiemposPorCompas = 4;
  const tiempoFuerte = (((golpes - (battito - 1)) % tiemposPorCompas) + tiemposPorCompas)
    % tiemposPorCompas;
  return {
    bpm: Math.round(bpm * 1000) / 1000,
    offset: Math.round(offset * 1000) / 1000,
    tiempoFuerte,
    tiemposPorCompas,
    variable: tempos.length > 1,
  };
}

/**
 * Los puntos de referencia de una pista.
 *
 * rekordbox tiene ocho de acceso rápido (`Num` de 0 a 7) y los de memoria
 * (`Num` −1), que son los que se ponen sin pad. Los cuatro primeros de acceso
 * rápido van a los cuatro pads; si no hay ninguno, se rellenan con los de
 * memoria por orden, que es lo que quiere quien solo usa memoria.
 */
export function cuesDeMarcas(marcas) {
  const puntos = [];
  const rapidos = marcas.filter((m) => (numero(m.Num) ?? -1) >= 0);
  const memoria = marcas.filter((m) => (numero(m.Num) ?? -1) < 0);
  for (const marca of rapidos) {
    const n = Math.round(numero(marca.Num));
    if (n >= CUES_POR_PISTA) continue;
    const segundo = numero(marca.Start);
    // `null >= 0` es cierto en JavaScript, así que hay que preguntar por el
    // número y no por el orden: una marca sin instante colaba como el segundo 0.
    if (!Number.isFinite(segundo) || segundo < 0) continue;
    puntos.push({ n: n + 1, segundo: Math.round(segundo * 1000) / 1000, nombre: marca.Name || '' });
  }
  const usados = new Set(puntos.map((p) => p.n));
  for (const marca of memoria) {
    if (usados.size >= CUES_POR_PISTA) break;
    const segundo = numero(marca.Start);
    if (!Number.isFinite(segundo) || segundo < 0) continue;
    let n = 1;
    while (n <= CUES_POR_PISTA && usados.has(n)) n += 1;
    if (n > CUES_POR_PISTA) break;
    usados.add(n);
    puntos.push({ n, segundo: Math.round(segundo * 1000) / 1000, nombre: marca.Name || '' });
  }
  return puntos.sort((a, b) => a.n - b.n);
}

/**
 * Lee una colección entera y devuelve lo que Pletina sabe guardar de cada
 * pista, más un recuento de lo que se ha quedado fuera.
 */
export function leerColeccion(xml) {
  const pistas = [];
  let dentroDeColeccion = false;
  let actual = null;
  let truncado = false;

  if (typeof xml !== 'string' || !xml.includes('<')) {
    return { pistas: [], truncado: false, esRekordbox: false };
  }
  const esRekordbox = /<DJ_PLAYLISTS/i.test(xml) || /<COLLECTION/i.test(xml);

  const cerrar = () => {
    if (!actual) return;
    const { atributos, tempos, marcas } = actual;
    actual = null;
    if (pistas.length >= MAXIMO_PISTAS) {
      truncado = true;
      return;
    }
    const bpmMedio = numero(atributos.AverageBpm);
    pistas.push({
      nombre: atributos.Name || '',
      artista: atributos.Artist || '',
      album: atributos.Album || '',
      ruta: rutaDeLocation(atributos.Location || ''),
      duracion: numero(atributos.TotalTime) ?? 0,
      bpm: bpmMedio,
      tono: atributos.Tonality || '',
      rejilla: rejillaDeTempos(tempos, bpmMedio),
      cues: cuesDeMarcas(marcas),
    });
  };

  for (const etiqueta of etiquetas(xml)) {
    if (etiqueta.nombre === 'COLLECTION') {
      if (etiqueta.cierra) { cerrar(); dentroDeColeccion = false; } else if (!etiqueta.sola) dentroDeColeccion = true;
      continue;
    }
    // Las pistas de `PLAYLISTS` son referencias por `Key`, sin datos: si se
    // leyeran, cada canción de cada lista entraría otra vez, vacía.
    if (!dentroDeColeccion) continue;
    if (etiqueta.nombre === 'TRACK') {
      if (etiqueta.cierra) { cerrar(); continue; }
      cerrar();
      actual = { atributos: etiqueta.atributos, tempos: [], marcas: [] };
      if (etiqueta.sola) cerrar();
      continue;
    }
    if (!actual) continue;
    if (etiqueta.nombre === 'TEMPO' && !etiqueta.cierra) actual.tempos.push(etiqueta.atributos);
    if (etiqueta.nombre === 'POSITION_MARK' && !etiqueta.cierra) actual.marcas.push(etiqueta.atributos);
  }
  cerrar();
  return { pistas, truncado, esRekordbox };
}

/** El nombre del archivo, en minúsculas, para poder comparar rutas de dos equipos. */
export const nombreDeArchivo = (ruta) => String(ruta ?? '')
  .replace(/\\/g, '/')
  .split('/')
  .pop()
  .toLowerCase();

const normalizar = (texto) => String(texto ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

/**
 * Empareja las pistas de la colección con las de la biblioteca.
 *
 * Por la ruta cuando coincide, que es lo seguro; por el nombre del archivo
 * cuando la biblioteca se movió de sitio o de equipo, que es lo normal; y por
 * título y artista como último recurso, exigiendo que la duración cuadre, que
 * es lo que evita emparejar dos versiones distintas de la misma canción.
 *
 * Lo que no encuentra pareja se cuenta y se dice. Un importador que se calla lo
 * que no ha importado es un importador que miente.
 */
export function emparejar(pistas, canciones) {
  const porRuta = new Map();
  const porArchivo = new Map();
  const porNombre = new Map();
  for (const track of canciones) {
    const ruta = String(track.path ?? '').replace(/\\/g, '/').toLowerCase();
    if (ruta) porRuta.set(ruta, track);
    const archivo = nombreDeArchivo(track.path);
    if (archivo && !porArchivo.has(archivo)) porArchivo.set(archivo, track);
    const clave = `${normalizar(track.title)}|${normalizar(track.artist)}`;
    if (clave !== '|' && !porNombre.has(clave)) porNombre.set(clave, track);
  }

  const parejas = [];
  const huerfanas = [];
  for (const pista of pistas) {
    const ruta = pista.ruta.replace(/\\/g, '/').toLowerCase();
    let track = ruta ? porRuta.get(ruta) : null;
    let como = 'ruta';
    if (!track) {
      track = porArchivo.get(nombreDeArchivo(pista.ruta));
      como = 'archivo';
    }
    if (!track) {
      const candidata = porNombre.get(`${normalizar(pista.nombre)}|${normalizar(pista.artista)}`);
      // Con el mismo título y el mismo artista todavía pueden ser dos versiones
      // distintas; que la duración cuadre a dos segundos ya no es casualidad.
      const cuadra = candidata && pista.duracion > 0 && candidata.duration > 0
        ? Math.abs(candidata.duration - pista.duracion) <= 2
        : false;
      if (cuadra) { track = candidata; como = 'nombre'; }
    }
    if (track) parejas.push({ pista, track, como });
    else huerfanas.push(pista);
  }
  return { parejas, huerfanas };
}
