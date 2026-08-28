import {
  chromaDeMuestras,
  detectarTempo,
  detectarTonalidad,
  envolventeDeAtaques,
} from '../shared/musica.js';
import { ANALISIS_VERSION, FUERZA_MINIMA, rejillaCompleta } from '../shared/beats.js';
import { calcularOndas, empaquetar } from '../shared/ondas.js';
import { esReproducible, nombreDeFormato } from '../shared/audio-files.js';

/**
 * Analiza una canción para sacarle tempo y tonalidad.
 *
 * Se hace bajo petición y no al importar: decodificar el audio entero cuesta
 * segundos y memoria, y una biblioteca de veinte mil canciones tardaría horas
 * en algo que casi nadie mira. Aquí solo se decodifica y se adelgaza la señal;
 * las cuentas viven en `shared/musica.js`, donde se pueden probar.
 */

const TASA_ANALISIS = 11025;
const TASA_ONDA = 22050;
const SEGUNDOS_MAXIMOS = 90;
/**
 * Cuánta canción entra en el ajuste de la rejilla. Es más de lo que se mira
 * para el tempo y la tonalidad: cuantos más golpes entran, más fino sale el
 * tempo, y de ahí sale que la rejilla siga cuadrando en el minuto seis.
 */
const SEGUNDOS_REJILLA = 240;

/** Mezcla a mono y baja la frecuencia de muestreo promediando, sin aliasing grosero. */
export function reducir(buffer, tasaDestino = TASA_ANALISIS) {
  const canales = Math.min(2, buffer.numberOfChannels);
  const factor = Math.max(1, Math.round(buffer.sampleRate / tasaDestino));
  const origen = [];
  for (let c = 0; c < canales; c += 1) origen.push(buffer.getChannelData(c));

  const salida = new Float32Array(Math.floor(buffer.length / factor));
  for (let i = 0; i < salida.length; i += 1) {
    let suma = 0;
    for (let j = 0; j < factor; j += 1) {
      const indice = i * factor + j;
      for (const canal of origen) suma += canal[indice] ?? 0;
    }
    salida[i] = suma / (factor * canales);
  }
  return { muestras: salida, tasa: buffer.sampleRate / factor };
}

/** Se queda con el tramo central: los principios y los finales engañan. */
export function tramoCentral(muestras, tasa, segundos = SEGUNDOS_MAXIMOS) {
  const maximo = Math.floor(segundos * tasa);
  if (muestras.length <= maximo) return muestras;
  const inicio = Math.floor((muestras.length - maximo) / 2);
  return muestras.subarray(inicio, inicio + maximo);
}

/**
 * Decodifica a una tasa fija, la misma en cualquier equipo.
 *
 * Antes se decodificaba con el contexto de reproducción, cuya tasa la fija la
 * tarjeta de sonido: enchufar unos auriculares Bluetooth cambiaba la tasa de
 * 44,1 a 48 kHz y con ella el resultado del análisis. La rejilla dejaba de ser
 * una propiedad de la canción para serlo del equipo, y dos personas con la
 * misma biblioteca veían números distintos.
 */
async function decodificar(datos) {
  const offline = new OfflineAudioContext(1, 1, TASA_ONDA);
  return offline.decodeAudioData(datos);
}

export async function analizarPista(id, ficha = null) {
  // Antes de leer nada: hay formatos que este programa importa —para quedarse
  // con sus etiquetas y su carátula— y no sabe decodificar. Analizarlos era
  // leer el archivo entero de disco para tirarlo, en cada pasada y para
  // siempre, sin decir nunca por qué.
  if (ficha && !esReproducible(ficha)) {
    const error = new Error(`${nombreDeFormato(ficha)}: este programa no sabe decodificar ese formato`);
    error.motivo = 'formato';
    throw error;
  }
  const respuesta = await fetch(window.pletina.media.track(id));
  if (!respuesta.ok) throw new Error('no he podido leer el archivo');
  const datos = await respuesta.arrayBuffer();
  let buffer;
  try {
    buffer = await decodificar(datos);
  } catch {
    const error = new Error(`${nombreDeFormato(ficha ?? {})}: el audio no se ha podido decodificar`);
    error.motivo = 'formato';
    throw error;
  }

  const { muestras, tasa } = reducir(buffer);

  // La onda se saca del doble de resolución que el análisis: los platos y los
  // charles viven por encima de los 5 kHz y a 11 kHz no se verían.
  const paraOnda = reducir(buffer, TASA_ONDA);
  const ondas = empaquetar(calcularOndas(paraOnda.muestras, paraOnda.tasa));

  // El tempo y la rejilla se miran en el MISMO tramo. Antes el tempo salía del
  // centro de la canción y la rejilla se ajustaba sobre los primeros cuatro
  // minutos: en cualquier archivo de más de nueve minos y medio —una sesión, un
  // directo, una cara de vinilo— el punto de partida venía de un sitio que el
  // ajuste no llegaba a mirar nunca.
  const largo = Math.min(muestras.length, Math.floor(tasa * SEGUNDOS_REJILLA));
  const paraRejilla = muestras.subarray(0, largo);
  const tramo = tramoCentral(paraRejilla, tasa);

  const { envolvente, tasa: tasaEnvolvente } = envolventeDeAtaques(tramo, tasa);
  const tempo = detectarTempo(envolvente, tasaEnvolvente);
  const tono = detectarTonalidad(chromaDeMuestras(tramo, tasa));
  // El tempo del detector es solo el punto de partida, y por eso se coge
  // incluso cuando viene con poca confianza: quien decide si hay pulso o no es
  // la rejilla, que mira la canción entera y sabe distinguir un ritmo flojo de
  // un ritmo que no está. Con el filtro puesto aquí, un hip-hop de bombo
  // espaciado se quedaba sin rejilla y sin poder mezclarse: el peor final.
  const bpmAprox = tempo.bpm;

  // La rejilla se ajusta sobre ese mismo tramo largo: cuantos más golpes entran
  // en el ajuste, más fino sale el tempo, y mirando desde el principio se sabe
  // además por dónde entra de verdad.
  const tanteo = bpmAprox ? rejillaCompleta(paraRejilla, tasa, bpmAprox) : null;
  // Sin contraste entre los golpes y lo que hay entre ellos aquí no hay pulso
  // que agarrar —una charla, un ambiente, una grabación de campo—, y una
  // rejilla inventada es peor que ninguna: cuadra el pinchazo con la nada.
  const rejilla = tanteo && tanteo.fuerza >= FUERZA_MINIMA ? tanteo : null;
  // Pero el tempo se da igual. Que una rejilla no sirva para pinchar no
  // significa que no se sepa a qué velocidad va la canción, y quedarse sin el
  // número —que es lo que pasaba— deja al usuario sin nada donde antes tenía
  // algo: sin dato, sin orden por tempo y sin saber por qué.
  const bpm = rejilla?.bpm || tanteo?.bpm || bpmAprox || 0;

  return {
    version: ANALISIS_VERSION,
    bpm,
    bpmConfianza: tempo.confianza,
    key: tono.confianza >= 0.55 ? tono.cifrado : '',
    tonalidad: tono.confianza >= 0.55 ? tono.tonalidad : '',
    keyConfianza: tono.confianza,
    // Sin tempo no hay rejilla que valga: se guarda que se ha mirado y ya.
    rejilla,
    // Y la onda, que se guarda aparte porque no cabe en la biblioteca.
    ondas,
  };
}
