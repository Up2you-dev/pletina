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
 *   plato B ─┘         │
 *                      └→ preescucha → salida de auriculares (si hay dos)
 *
 * La preescucha por otra salida es lo que separa una cabina de un reproductor:
 * escuchar por los cascos lo que todavía no suena en la sala. El nodo que lo
 * hace posible es `MediaStreamAudioDestinationNode`: un segundo destino del
 * mismo grafo que sale por un `<audio>` propio, y a un `<audio>` sí se le puede
 * decir por qué dispositivo suena (`setSinkId`). Al contexto no.
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

  // La cadena de cascos: la suma de las derivaciones de los platos más, si se
  // pide, lo que suena en la sala. Un pinchadiscos quiere las dos cosas a la
  // vez para poder cuadrar de oído; el mando de mezcla decide cuánto de cada.
  const aCascos = contexto.createGain();
  const salaEnCascos = contexto.createGain();
  salaEnCascos.gain.value = 0;
  const cascos = contexto.createGain();
  aCascos.connect(cascos);
  maestro.connect(salaEnCascos);
  salaEnCascos.connect(cascos);

  // El segundo destino solo se crea si el navegador lo tiene: sin él, la
  // preescucha sigue siendo la de siempre —bajita, por la misma salida— y
  // ningún control promete lo que no hay.
  let destinoCascos = null;
  let salidaCascos = null;
  try {
    if (typeof contexto.createMediaStreamDestination === 'function') {
      destinoCascos = contexto.createMediaStreamDestination();
      cascos.connect(destinoCascos);
      salidaCascos = new Audio();
      salidaCascos.srcObject = destinoCascos.stream;
      salidaCascos.autoplay = true;
      salidaCascos.volume = 1;
    }
  } catch {
    destinoCascos = null;
    salidaCascos = null;
  }

  const fuentes = new WeakMap();

  /**
   * Engancha un `<audio>` al grafo con su propio ecualizador de tres bandas.
   *
   * Cada plato necesita el suyo: el cambio de graves de una mezcla consiste en
   * quitárselos a una canción y devolvérselos a la otra, y con un ecualizador
   * compartido eso es imposible. Un elemento solo admite una fuente en toda su
   * vida, así que se memoriza: pedirla dos veces lanzaría una excepción.
   */
  function conectar(elemento) {
    if (fuentes.has(elemento)) return fuentes.get(elemento);
    const fuente = contexto.createMediaElementSource(elemento);

    const grave = contexto.createBiquadFilter();
    grave.type = 'lowshelf';
    grave.frequency.value = 220;

    const medio = contexto.createBiquadFilter();
    medio.type = 'peaking';
    medio.frequency.value = 1000;
    medio.Q.value = 0.9;

    const agudo = contexto.createBiquadFilter();
    agudo.type = 'highshelf';
    agudo.frequency.value = 4000;

    const ganancia = contexto.createGain();

    // Y la tira de canal, que es de la persona y no de la mezcla.
    //
    // Van aparte a propósito. Los tres filtros de arriba y `ganancia` son los
    // que automatiza una transición; si el ecualizador de mano escribiera en
    // esos mismos, cada rampa programada borraría lo que acabas de mover y cada
    // giro de perilla rompería la mezcla en curso. Con dos juegos en serie,
    // cada uno manda en lo suyo y ninguno pisa al otro.
    const mGrave = contexto.createBiquadFilter();
    mGrave.type = 'lowshelf';
    mGrave.frequency.value = 220;

    const mMedio = contexto.createBiquadFilter();
    mMedio.type = 'peaking';
    mMedio.frequency.value = 1000;
    mMedio.Q.value = 0.9;

    const mAgudo = contexto.createBiquadFilter();
    mAgudo.type = 'highshelf';
    mAgudo.frequency.value = 4000;

    // Un solo mando bipolar, como en cualquier mesa: a la izquierda cierra por
    // arriba, a la derecha abre por abajo, en el centro no hace nada.
    const filtro = contexto.createBiquadFilter();
    filtro.type = 'lowpass';
    filtro.frequency.value = 22050;
    filtro.Q.value = 0.7;

    const trim = contexto.createGain();

    // La derivación a los cascos. Sale ANTES de la ganancia de mezcla a
    // propósito: lo que se preescucha es el plato, suene o no en la sala, y con
    // la transición a medias su ganancia va camino de cero.
    const cascos = contexto.createGain();
    cascos.gain.value = 0;

    fuente.connect(grave);
    grave.connect(medio);
    medio.connect(agudo);
    agudo.connect(mGrave);
    mGrave.connect(mMedio);
    mMedio.connect(mAgudo);
    mAgudo.connect(filtro);
    filtro.connect(trim);
    trim.connect(ganancia);
    trim.connect(cascos);
    cascos.connect(aCascos);
    ganancia.connect(entradaEq);

    const plato = {
      fuente, ganancia, grave, medio, agudo, mGrave, mMedio, mAgudo, filtro, trim, cascos,
    };
    fuentes.set(elemento, plato);
    return plato;
  }

  /**
   * La tira de canal de un plato: ecualizador de mano, filtro y volumen.
   *
   * Los decibelios se aplican tal cual —el nodo los toma en dB— y el filtro se
   * mueve en escala logarítmica, que es como se oye: de 20 kHz a 200 Hz cerrando
   * y de 20 Hz a 8 kHz abriendo.
   */
  function ajustarTira(plato, { grave, medio, agudo, filtro, volumen } = {}) {
    if (!plato) return;
    const ahora = contexto.currentTime;
    const suave = (parametro, valor) => {
      parametro.cancelScheduledValues(ahora);
      parametro.setTargetAtTime(valor, ahora, 0.01);
    };
    if (Number.isFinite(grave)) suave(plato.mGrave.gain, grave);
    if (Number.isFinite(medio)) suave(plato.mMedio.gain, medio);
    if (Number.isFinite(agudo)) suave(plato.mAgudo.gain, agudo);
    if (Number.isFinite(volumen)) suave(plato.trim.gain, Math.max(0, Math.min(1.4, volumen)));
    if (Number.isFinite(filtro)) {
      const v = Math.max(-1, Math.min(1, filtro));
      if (Math.abs(v) < 0.02) {
        plato.filtro.type = 'lowpass';
        suave(plato.filtro.frequency, 22050);
      } else if (v < 0) {
        plato.filtro.type = 'lowpass';
        suave(plato.filtro.frequency, 20000 * (200 / 20000) ** -v);
      } else {
        plato.filtro.type = 'highpass';
        suave(plato.filtro.frequency, 20 * (8000 / 20) ** v);
      }
    }
  }

  /**
   * Deja un plato como si nadie lo hubiera tocado.
   *
   * Solo lo de la mezcla: el ecualizador de mano, el filtro y el volumen del
   * canal son de la persona, y una transición no tiene por qué llevárselos.
   */
  function limpiarPlato(plato, cuando = contexto.currentTime) {
    if (!plato) return;
    for (const nombre of ['grave', 'medio', 'agudo']) {
      const filtro = plato[nombre];
      filtro.gain.cancelScheduledValues(cuando);
      filtro.gain.setValueAtTime(0, cuando);
    }
    plato.ganancia.gain.cancelScheduledValues(cuando);
    plato.ganancia.gain.setValueAtTime(1, cuando);
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

  /**
   * Cuánto de cada plato va a los cascos, de 0 a 1. `null` deja el plato como
   * está, para poder tocar uno sin pisar el otro.
   */
  function ajustarCascos(plato, valor) {
    if (!plato?.cascos) return;
    const ahora = contexto.currentTime;
    plato.cascos.gain.cancelScheduledValues(ahora);
    plato.cascos.gain.setTargetAtTime(Math.max(0, Math.min(1, valor)), ahora, 0.01);
  }

  return {
    contexto,
    analizador,
    conectar,
    limpiarPlato,
    ajustarTira,
    ajustarCascos,
    despertar,
    /** ¿Hay una salida de cascos de verdad, separada de la de la sala? */
    get hayCascos() {
      return Boolean(salidaCascos);
    },
    /**
     * Manda los cascos a un dispositivo concreto. Sin `setSinkId` —o con un
     * identificador que ya no existe— se dice que no, en vez de fingir que sí.
     */
    async salidaDeCascos(deviceId) {
      if (!salidaCascos) return false;
      if (typeof salidaCascos.setSinkId !== 'function') return false;
      try {
        await salidaCascos.setSinkId(deviceId || '');
        await salidaCascos.play().catch(() => {});
        return true;
      } catch {
        return false;
      }
    },
    /** Cuánto de la sala se oye por los cascos, para poder cuadrar de oído. */
    mezclaDeCascos(valor) {
      const ahora = contexto.currentTime;
      salaEnCascos.gain.cancelScheduledValues(ahora);
      salaEnCascos.gain.setTargetAtTime(Math.max(0, Math.min(1, valor)), ahora, 0.02);
    },
    /** Volumen de los cascos, aparte del de la sala. */
    volumenDeCascos(valor) {
      const ahora = contexto.currentTime;
      cascos.gain.cancelScheduledValues(ahora);
      cascos.gain.setTargetAtTime(Math.max(0, Math.min(1.5, valor)), ahora, 0.02);
    },
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
