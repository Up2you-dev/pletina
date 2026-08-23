/**
 * El grafo de audio.
 *
 * Hasta la 1.1 el volumen se hacía con `audio.volume` y nada más. Un ecualizador,
 * un visualizador y una mezcla con fundido necesitan meter el sonido por Web
 * Audio, y eso trae dos condiciones que no se ven venir: el elemento tiene que
 * pedir permiso de origen cruzado —`pletina-media://` responde con la cabecera
 * correspondiente— o el grafo suena a silencio sin dar un solo error; y el
 * contexto arranca suspendido hasta que hay una interacción.
 *
 *   plato A ─┐
 *            ├→ ganancia de plato → ecualizador → maestro → analizador → salida
 *   plato B ─┘
 */

/** Diez bandas por octava, de subgraves a brillo. */
export const BANDAS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const PRESETS = {
  plano: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  grave: [6, 5, 4, 2, 0, 0, 0, 0, 1, 2],
  voz: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  brillo: [-1, -1, 0, 0, 1, 2, 3, 4, 5, 5],
  clasica: [3, 2, 1, 0, 0, 0, -1, -1, 1, 2],
  radio: [4, 3, 1, -1, -2, 0, 2, 3, 3, 2],
};

export const NOMBRES_PRESET = {
  plano: 'Plano',
  grave: 'Más graves',
  voz: 'Voz clara',
  brillo: 'Más brillo',
  clasica: 'Clásica',
  radio: 'Radio',
};

export function createEngine() {
  const contexto = new AudioContext({ latencyHint: 'playback' });

  // Cadena del ecualizador: la primera y la última banda son estanterías, las de
  // en medio campanas; así los extremos no se quedan cojos.
  const filtros = BANDAS.map((frecuencia, i) => {
    const filtro = contexto.createBiquadFilter();
    filtro.type = i === 0 ? 'lowshelf' : i === BANDAS.length - 1 ? 'highshelf' : 'peaking';
    filtro.frequency.value = frecuencia;
    filtro.Q.value = 1.1;
    filtro.gain.value = 0;
    return filtro;
  });
  filtros.reduce((anterior, actual) => {
    anterior.connect(actual);
    return actual;
  });

  const entradaEq = filtros[0];
  const salidaEq = filtros[filtros.length - 1];

  const preamp = contexto.createGain();
  const maestro = contexto.createGain();
  const analizador = contexto.createAnalyser();
  analizador.fftSize = 2048;
  analizador.smoothingTimeConstant = 0.78;

  salidaEq.connect(preamp);
  preamp.connect(maestro);
  maestro.connect(analizador);
  analizador.connect(contexto.destination);

  const fuentes = new WeakMap();

  /**
   * Engancha un `<audio>` al grafo. Un elemento solo admite una fuente en toda
   * su vida, así que se memoriza: pedirla dos veces lanzaría una excepción.
   */
  function conectar(elemento) {
    if (fuentes.has(elemento)) return fuentes.get(elemento);
    const fuente = contexto.createMediaElementSource(elemento);
    const ganancia = contexto.createGain();
    fuente.connect(ganancia);
    ganancia.connect(entradaEq);
    const plato = { fuente, ganancia };
    fuentes.set(elemento, plato);
    return plato;
  }

  /** El contexto nace suspendido: se despierta con la primera reproducción. */
  async function despertar() {
    if (contexto.state === 'suspended') {
      try {
        await contexto.resume();
      } catch {
        /* si el sistema no deja, el elemento sigue sonando por su cuenta */
      }
    }
  }

  return {
    contexto,
    analizador,
    conectar,
    despertar,
    get tiempo() {
      return contexto.currentTime;
    },
    /** Ganancia de banda, en decibelios. */
    banda(indice, db) {
      const filtro = filtros[indice];
      if (filtro) filtro.gain.value = Math.max(-12, Math.min(12, Number(db) || 0));
    },
    aplicarBandas(valores = []) {
      valores.forEach((db, i) => this.banda(i, db));
    },
    preamplificar(db) {
      preamp.gain.value = 10 ** (Math.max(-12, Math.min(12, Number(db) || 0)) / 20);
    },
    /** Volumen general, con la curva percibida aplicada por quien llama. */
    volumen(valor) {
      maestro.gain.value = Math.max(0, Math.min(1, valor));
    },
    /** Deja el ecualizador transparente sin apagarlo. */
    plano() {
      filtros.forEach((filtro) => {
        filtro.gain.value = 0;
      });
      preamp.gain.value = 1;
    },
  };
}
