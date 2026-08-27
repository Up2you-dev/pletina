import { desempaquetar } from '../shared/ondas.js';

/**
 * Las ondas, del disco a la pantalla.
 *
 * Se piden una vez y se quedan en memoria: una onda son ciento treinta
 * kilobytes y el visor la lee sesenta veces por segundo, así que no puede
 * cruzar el puente de procesos en cada cuadro. Se guardan pocas —las de los
 * platos y poco más— porque tampoco hace falta tener la biblioteca entera
 * cargada para mirar dos canciones.
 */

const CUANTAS = 8;
const cargadas = new Map();
const pidiendo = new Map();

/** La onda si ya está en memoria. El visor pinta con esto, sin esperar a nadie. */
export function ondaCargada(id) {
  if (!id) return null;
  const encontrada = cargadas.get(id);
  if (encontrada === undefined) return null;
  return encontrada;
}

/** Pide la onda al proceso principal. Devuelve null si esa canción no tiene. */
export async function pedirOnda(id) {
  if (!id) return null;
  if (cargadas.has(id)) return cargadas.get(id);
  if (pidiendo.has(id)) return pidiendo.get(id);

  const promesa = (async () => {
    let ondas = null;
    try {
      ondas = desempaquetar(await window.pletina.track.onda(id));
    } catch {
      ondas = null;
    }
    // La más vieja se va: un Map recuerda el orden en que entraron.
    while (cargadas.size >= CUANTAS) cargadas.delete(cargadas.keys().next().value);
    cargadas.set(id, ondas);
    pidiendo.delete(id);
    return ondas;
  })();
  pidiendo.set(id, promesa);
  return promesa;
}

/** Al reanalizar una canción, su onda de antes ya no vale. */
export function olvidarOnda(id) {
  cargadas.delete(id);
  pidiendo.delete(id);
}
