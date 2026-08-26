import {
  chromaDeMuestras,
  detectarTempo,
  detectarTonalidad,
  envolventeDeAtaques,
} from '../shared/musica.js';
import { rejillaCompleta } from '../shared/beats.js';

/**
 * Analiza una canción para sacarle tempo y tonalidad.
 *
 * Se hace bajo petición y no al importar: decodificar el audio entero cuesta
 * segundos y memoria, y una biblioteca de veinte mil canciones tardaría horas
 * en algo que casi nadie mira. Aquí solo se decodifica y se adelgaza la señal;
 * las cuentas viven en `shared/musica.js`, donde se pueden probar.
 */

const TASA_ANALISIS = 11025;
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

export async function analizarPista(id, contexto) {
  const respuesta = await fetch(window.pletina.media.track(id));
  if (!respuesta.ok) throw new Error('no he podido leer el archivo');
  const datos = await respuesta.arrayBuffer();
  const buffer = await contexto.decodeAudioData(datos);

  const { muestras, tasa } = reducir(buffer);
  const tramo = tramoCentral(muestras, tasa);

  const { envolvente, tasa: tasaEnvolvente } = envolventeDeAtaques(tramo, tasa);
  const tempo = detectarTempo(envolvente, tasaEnvolvente);
  const tono = detectarTonalidad(chromaDeMuestras(tramo, tasa));
  const bpmAprox = tempo.confianza >= 0.12 ? tempo.bpm : 0;

  // La rejilla se ajusta sobre la canción entera —hasta un límite— y no sobre
  // un trozo: cuantos más golpes entran en el ajuste, más fino sale el tempo, y
  // mirando desde el principio se sabe además por dónde entra de verdad. Su
  // tempo es el bueno: el del detector es solo el punto de partida.
  const largo = Math.min(muestras.length, Math.floor(tasa * SEGUNDOS_REJILLA));
  const rejilla = bpmAprox
    ? rejillaCompleta(muestras.subarray(0, largo), tasa, bpmAprox)
    : null;
  const bpm = rejilla?.bpm || bpmAprox;

  return {
    bpm,
    bpmConfianza: tempo.confianza,
    key: tono.confianza >= 0.55 ? tono.cifrado : '',
    tonalidad: tono.confianza >= 0.55 ? tono.tonalidad : '',
    keyConfianza: tono.confianza,
    // Sin tempo no hay rejilla que valga: se guarda que se ha mirado y ya.
    rejilla,
  };
}
