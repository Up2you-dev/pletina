/**
 * Analizar en lote.
 *
 * Analizar una canción cuesta segundos —lo caro es decodificar el audio
 * entero—, así que una biblioteca de mil canciones son horas. Eso no puede ser
 * un botón que se queda pensando sin decir nada: es un trabajo con cola, con
 * progreso, que se puede parar a la mitad y que no repite lo que ya está hecho.
 *
 * Aquí no se decodifica nada: esto solo lleva la cola. Quien analiza y quien
 * guarda se inyectan, para poder probar la cola sin tarjeta de sonido.
 */

let trabajo = null;

/** ¿Hay un lote en marcha? */
export const analizandoLote = () => Boolean(trabajo);

/** Estado del lote, para pintarlo. */
export const estadoDelLote = () => (trabajo ? { ...trabajo } : null);

/** Parar en cuanto termine la canción que esté analizando. */
export function cancelarLote() {
  if (trabajo) trabajo.cancelado = true;
}

/**
 * @param {string[]} ids
 * @param {object} opciones
 * @param {(id: string) => Promise<object>} opciones.analizar
 * @param {(id: string, resultado: object) => Promise<unknown>} opciones.guardar
 * @param {(id: string) => boolean} [opciones.yaHecha]   para saltarse lo analizado
 * @param {(id: string) => string} [opciones.titulo]     para poder decir qué suena
 * @param {(estado: object|null) => void} [opciones.alProgreso]
 * @param {boolean} [opciones.forzar]                    rehacer aunque esté hecha
 */
export async function analizarLote(ids, {
  analizar,
  guardar,
  yaHecha = () => false,
  titulo = () => '',
  alProgreso = () => {},
  forzar = false,
} = {}) {
  if (trabajo) return { ok: false, motivo: 'Ya hay un análisis en marcha.' };
  const lista = [...new Set(ids ?? [])].filter(Boolean);
  const pendientes = forzar ? lista : lista.filter((id) => !yaHecha(id));

  trabajo = {
    total: pendientes.length,
    hechas: 0,
    fallidas: 0,
    saltadas: lista.length - pendientes.length,
    cancelado: false,
    titulo: '',
  };
  if (!pendientes.length) {
    const resumen = { ok: true, ...trabajo };
    trabajo = null;
    alProgreso(null);
    return resumen;
  }

  alProgreso({ ...trabajo });
  for (const id of pendientes) {
    if (trabajo.cancelado) break;
    trabajo.titulo = titulo(id) || '';
    alProgreso({ ...trabajo });
    try {
      const resultado = await analizar(id);
      await guardar(id, resultado);
      trabajo.hechas += 1;
    } catch {
      // Una canción rota no puede tumbar el lote: se cuenta y se sigue.
      trabajo.fallidas += 1;
    }
    // Un respiro entre canciones: la ventana tiene que seguir respondiendo.
    await new Promise((listo) => { setTimeout(listo, 0); });
  }

  const resumen = { ok: true, ...trabajo, pendientesSinHacer: trabajo.total - trabajo.hechas - trabajo.fallidas };
  trabajo = null;
  alProgreso(null);
  return resumen;
}
