import { getTrack, state } from './state.js';
import { toast } from './ui/dom.js';
import { createEngine } from './audio.js';

/**
 * El reproductor: dos platos apuntando al esquema `pletina-media://`, que sirve
 * el archivo del disco con soporte de `Range`. Sin copias, sin blobs en memoria
 * y con la barra de posición funcionando también en archivos de 200 MB.
 *
 * Son dos y no uno porque encadenar con fundido exige que la siguiente canción
 * ya esté sonando antes de que termine la anterior. Sin fundido, el segundo
 * plato no se usa y el comportamiento es el de siempre.
 */

let motor = null;
try {
  motor = createEngine();
} catch {
  // Sin Web Audio se pierden ecualizador, visualizador y fundido, pero la
  // música tiene que sonar igual: eso no se negocia.
  motor = null;
}

function crearPlato() {
  const el = new Audio();
  el.preload = 'auto';
  // Imprescindible para que Web Audio no reciba silencio: el audio vive en otro
  // esquema y sin esto el grafo queda «contaminado» y enmudece sin avisar.
  if (motor) el.crossOrigin = 'anonymous';
  const nodos = motor ? motor.conectar(el) : null;
  return { el, nodos, id: null };
}

const platos = [crearPlato(), crearPlato()];
let activo = 0;
const plato = () => platos[activo];
const otro = () => platos[1 - activo];

let encadenando = false;
let avisadoFinal = false;
/** Cuánto suena el plato preparado cuando se preescucha. */
const PREESCUCHA = 0.55;
/**
 * Qué plato tiene algo preparado, o null.
 *
 * Hace falta apuntarlo: «el otro plato» no vale como definición, porque en
 * cuanto empieza una mezcla los papeles se cambian y el que salía pasaría a
 * parecer el preparado.
 */
let platoConPreparada = null;
/** Número de la mezcla en curso: distingue una transición de la siguiente. */
let mezclaActual = 0;
let fallos = 0;
let guardado = 0;
let warmup = null;

const hooks = {
  onEnded: () => {},
  onError: () => {},
  onTrack: () => {},
  onTick: () => {},
  onPlayState: () => {},
  onPositionSave: () => {},
  onCercaDelFinal: () => {},
  onMezcla: () => {},
  onPreparado: () => {},
  /** Segundos de fundido, o 0 para encadenar sin cruce. Lo decide la interfaz. */
  margenDeFundido: () => 0,
};

export function onPlayer(handlers) {
  Object.assign(hooks, handlers);
}

export const engine = () => motor;
export const hayMotor = () => Boolean(motor);
export const mezclando = () => encadenando;
/** El plato que está sonando, para que el mezclador sepa dónde va. */
export const platoActivo = () => ({
  id: plato().id,
  tiempo: plato().el.currentTime || 0,
  // Si viene de una mezcla anterior puede ir ajustado: su tempo real es el de
  // la canción por esta velocidad, y el mezclador tiene que contar con ello.
  velocidad: plato().el.playbackRate || 1,
});

/**
 * Qué está haciendo cada plato ahora mismo: volumen, ecualización y velocidad.
 * El mezclador lo enseña en pantalla durante la transición, que es la única
 * manera de ver el cambio de graves ocurriendo.
 */
export function estadoDePlatos() {
  return platos.map((p, indice) => ({
    indice,
    activo: indice === activo,
    id: p.id,
    tiempo: p.el.currentTime || 0,
    velocidad: p.el.playbackRate,
    estirando: p.el.preservesPitch !== false,
    sonando: !p.el.paused,
    ganancia: p.nodos ? Math.round(p.nodos.ganancia.gain.value * 100) / 100 : null,
    grave: p.nodos ? Math.round(p.nodos.grave.gain.value * 10) / 10 : null,
    medio: p.nodos ? Math.round(p.nodos.medio.gain.value * 10) / 10 : null,
    agudo: p.nodos ? Math.round(p.nodos.agudo.gain.value * 10) / 10 : null,
  }));
}

/* ------------------------------------------------------- el plato que se prepara */

/**
 * El segundo plato, antes de la mezcla.
 *
 * Un pinchadiscos no espera a que la cola decida: carga la siguiente en el
 * plato libre, la coloca donde quiere que entre y la deja esperando. Eso es lo
 * que hace esto. El plato preparado no suena —o suena bajito, si se pide
 * preescucha— y, cuando llega la mezcla, ya está cargado: entra sin el retardo
 * de abrir un archivo, que era de los peores enemigos de que cuadrara.
 */
export function prepararPlato(id, { en = 0, escuchar = false } = {}) {
  if (!motor || encadenando) return false;
  const track = getTrack(id);
  const libre = otro();
  if (!track || !libre.nodos) return false;

  platoConPreparada = 1 - activo;
  libre.id = id;
  libre.el.src = window.pletina.media.track(id);
  libre.el.preservesPitch = true;
  libre.el.playbackRate = 1;
  motor.limpiarPlato(libre.nodos);
  fijarGanancia(libre, escuchar ? PREESCUCHA : 0);

  const colocar = () => {
    try {
      libre.el.currentTime = Math.max(0, en);
    } catch {
      /* aún sin metadatos */
    }
  };
  colocar();
  libre.el.addEventListener('loadedmetadata', colocar, { once: true });
  if (escuchar) {
    const promesa = libre.el.play();
    if (promesa?.catch) promesa.catch(() => {});
  } else {
    libre.el.pause();
  }
  hooks.onPreparado?.(estadoPreparado());
  return true;
}

/** El plato con algo preparado, si lo hay. */
function preparado() {
  if (platoConPreparada === null) return null;
  const candidato = platos[platoConPreparada];
  return candidato?.id ? candidato : null;
}

/** Mueve el plato preparado sin ruido: está parado, así que no chasquea. */
export function moverPreparado(segundo) {
  const libre = preparado();
  if (!libre || encadenando) return false;
  try {
    libre.el.currentTime = Math.max(0, segundo);
  } catch {
    return false;
  }
  hooks.onPreparado?.(estadoPreparado());
  return true;
}

/** Preescucha: el plato preparado suena por encima, bajito, para encontrar la entrada. */
export function escucharPreparado(activar) {
  const libre = preparado();
  if (!libre || encadenando) return false;
  fijarGanancia(libre, activar ? PREESCUCHA : 0);
  if (activar) {
    motor?.despertar();
    const promesa = libre.el.play();
    if (promesa?.catch) promesa.catch(() => {});
  } else {
    libre.el.pause();
  }
  hooks.onPreparado?.(estadoPreparado());
  return true;
}

/** Deja el plato libre otra vez. */
export function soltarPreparado() {
  const libre = preparado();
  if (!libre || encadenando) return false;
  libre.el.pause();
  libre.el.removeAttribute('src');
  libre.id = null;
  if (motor) motor.limpiarPlato(libre.nodos);
  platoConPreparada = null;
  hooks.onPreparado?.(estadoPreparado());
  return true;
}

export function estadoPreparado() {
  const libre = preparado();
  if (!libre) return { id: null, tiempo: 0, escuchando: false, listo: false };
  return {
    id: libre.id,
    tiempo: libre.el.currentTime || 0,
    escuchando: !libre.el.paused,
    listo: libre.el.readyState >= 1,
  };
}

/**
 * El empujón manual: mueve la fase del plato que suena sin dar un salto.
 *
 * Es lo que hace un pinchadiscos con el dedo en el plato, y la única manera de
 * corregir un desfase sin que se oiga un corte: se acelera o se frena un pelo
 * el tiempo justo para recuperar los milisegundos que faltan.
 */
export function empujar(segundos, { plato: cual = 'activo' } = {}) {
  const objetivo = cual === 'preparado' ? preparado() : plato();
  if (!objetivo?.id || !Number.isFinite(segundos) || !segundos) return false;
  const base = cual === 'preparado' ? 1 : tempo.velocidad;
  if (cual === 'preparado' && objetivo.el.paused) {
    // Parado no hay nada que empujar: se mueve y ya.
    return moverPreparado((objetivo.el.currentTime || 0) + segundos);
  }
  const empuje = 0.06 * Math.sign(segundos);
  const duracionEmpuje = Math.min(3, Math.abs(segundos) / (base * 0.06));
  objetivo.el.playbackRate = base * (1 + empuje);
  clearTimeout(objetivo.empujando);
  objetivo.empujando = setTimeout(() => {
    objetivo.el.playbackRate = cual === 'preparado' ? 1 : tempo.velocidad;
  }, duracionEmpuje * 1000);
  return true;
}

/* ------------------------------------------------------------------- tempo */

/**
 * Tempo de reproducción. Vive aquí y no en la interfaz porque el mezclador
 * también lo toca: cuando una mezcla ajusta el tempo de la que entra, ese pasa
 * a ser el tempo del reproductor y el panel tiene que enseñar la verdad.
 *
 * `preservarTono` es lo que separa un ajuste usable de una cinta acelerada:
 * con él el motor hace estirado de tiempo real (la canción va más rápida y
 * sigue en la misma tonalidad); sin él sube el tono como un vinilo.
 */
let tempo = { velocidad: 1, preservarTono: true, origen: 'manual' };

function aplicarTempo(p) {
  if (!p?.el) return;
  p.el.preservesPitch = tempo.preservarTono;
  p.el.playbackRate = tempo.velocidad;
}

/** El tempo que suena ahora mismo, para que la interfaz no se lo invente. */
export const tempoActual = () => ({ ...tempo });

export function ajustarVelocidad(velocidad, preservarTono = tempo.preservarTono) {
  tempo = {
    velocidad: Math.max(0.5, Math.min(2, Number(velocidad) || 1)),
    preservarTono: Boolean(preservarTono),
    origen: 'manual',
  };
  aplicarTempo(plato());
  return tempoActual();
}

/* ------------------------------------------------------------------ volumen */

/** Volumen percibido: la curva cuadrática se parece a cómo oye una persona. */
function volumenEfectivo() {
  const base = state.muted ? 0 : state.volume ** 2;
  if (!state.normalize) return base;
  const track = getTrack(state.currentId);
  const gainDb = track?.gainDb;
  if (!Number.isFinite(gainDb)) return base;
  // ReplayGain solo se usa para bajar: subir por encima de 1 distorsiona.
  return Math.max(0, Math.min(1, base * Math.min(1, 10 ** (gainDb / 20))));
}

export function applyVolume() {
  const valor = volumenEfectivo();
  if (motor) {
    motor.volumen(valor);
    for (const p of platos) p.el.volume = 1;
    return;
  }
  for (const p of platos) p.el.volume = valor;
}

/** Ecualizador: bandas en decibelios más una preamplificación. */
export function aplicarEcualizador({ activado, bandas = [], preamp = 0 } = {}) {
  if (!motor) return;
  if (!activado) {
    motor.plano();
    return;
  }
  motor.aplicarBandas(bandas);
  motor.preamplificar(preamp);
}

/* -------------------------------------------------------------- reproducción */

function ganancia(p) {
  return p.nodos?.ganancia?.gain ?? null;
}

function fijarGanancia(p, valor) {
  const parametro = ganancia(p);
  if (!parametro) return;
  parametro.cancelScheduledValues(motor.tiempo);
  parametro.setValueAtTime(valor, motor.tiempo);
}

export function load(id, { play = true, position = 0 } = {}) {
  // La preescucha se apaga antes de tocar nada: si no, el plato preparado se
  // quedaba sonando a media voz encima de la canción nueva, sin ningún control
  // a la vista que lo explicara —el botón vive en la cabina, que puede ni estar
  // abierta— y con el botón encendido mintiendo.
  if (estadoPreparado().escuchando) escucharPreparado(false);
  const track = getTrack(id);
  if (!track) return false;
  cancelarFundido();
  const actual = plato();
  actual.id = id;
  state.currentId = id;
  avisadoFinal = false;
  fijarGanancia(actual, 1);
  // Elegir una canción a mano cierra la cadena de la mezcla: el ajuste de tempo
  // que puso el mezclador para encajar dos canciones no tiene por qué quedarse
  // puesto para siempre. El que ha puesto una persona sí se respeta.
  if (tempo.origen === 'mezcla') tempo = { velocidad: 1, preservarTono: tempo.preservarTono, origen: 'manual' };
  actual.el.src = window.pletina.media.track(id);
  // Después del `src`, nunca antes: asignar la fuente reinicia el elemento y
  // con él la velocidad. El tempo elegido se vuelve a poner encima.
  aplicarTempo(actual);
  if (position > 0) {
    const buscar = () => {
      try {
        actual.el.currentTime = position;
      } catch {
        /* el archivo no admite búsqueda antes de tener metadatos */
      }
      actual.el.removeEventListener('loadedmetadata', buscar);
    };
    actual.el.addEventListener('loadedmetadata', buscar);
  }
  applyVolume();
  hooks.onTrack(track);
  setMediaSession(track);
  if (play) start();
  return true;
}

export function start() {
  motor?.despertar();
  const promesa = plato().el.play();
  if (promesa?.catch) promesa.catch(() => hooks.onPlayState(false));
}

export const pause = () => {
  // Pausar a mitad de una mezcla la corta: si no, al volver solo arrancaría uno
  // de los dos platos y la automatización ya habría seguido su camino.
  cancelarFundido();
  for (const p of platos) p.el.pause();
};

export function toggle() {
  if (plato().el.paused) start();
  else pause();
}

export function seekTo(seconds) {
  const el = plato().el;
  if (!Number.isFinite(el.duration) || el.duration <= 0) return;
  cancelarFundido();
  el.currentTime = Math.max(0, Math.min(el.duration, seconds));
  avisadoFinal = false;
}

export function seekBy(delta) {
  seekTo((plato().el.currentTime || 0) + delta);
}

export const currentTime = () => plato().el.currentTime || 0;
export const duration = () => (Number.isFinite(plato().el.duration) ? plato().el.duration : 0);

export function restart() {
  plato().el.currentTime = 0;
  start();
}

export function stop() {
  cancelarFundido();
  for (const p of platos) {
    p.el.pause();
    p.el.removeAttribute('src');
    p.el.load();
    p.id = null;
  }
  state.currentId = null;
  hooks.onTrack(null);
}

/** Calienta el siguiente archivo sin reproducirlo. */
export function warmNext(id) {
  if (!id || warmup?.dataset?.id === id) return;
  warmup = new Audio();
  warmup.dataset.id = id;
  warmup.preload = 'auto';
  warmup.muted = true;
  warmup.src = window.pletina.media.track(id);
}

/* ------------------------------------------------------------------ fundido */

/**
 * Corta una transición a medias y deja los dos platos como estaban.
 *
 * Lo importante es lo de «como estaban»: a mitad de una mezcla, el plato que
 * suena tiene los graves quitados y los medios pellizcados. Si se corta sin
 * devolverlos, la canción sigue sonando sin graves para siempre y no hay manera
 * de saber por qué.
 */
function cancelarFundido() {
  if (!encadenando) return;
  encadenando = false;
  mezclaActual += 1;
  platoConPreparada = null;
  const otroPlato = otro();
  otroPlato.el.pause();
  otroPlato.el.removeAttribute('src');
  otroPlato.id = null;
  if (motor) {
    motor.limpiarPlato(otroPlato.nodos);
    motor.limpiarPlato(plato().nodos);
  }
  fijarGanancia(plato(), 1);
  hooks.onMezcla?.({ en: 'fin', cancelada: true });
}

/**
 * Ejecuta un plan de mezcla (`shared/mezcla.js`) sobre los dos platos.
 *
 * El plan dice qué hacer y cuándo; aquí solo se traduce a automatización del
 * grafo. Todo se programa de una vez sobre el reloj del audio, no con
 * temporizadores de JavaScript: un `setTimeout` llega tarde y en una mezcla eso
 * son dos bombos pisándose.
 */
export function mezclar(id, plan, { estirarTiempo = true } = {}) {
  if (!motor || encadenando) return false;
  const entrante = otro();
  const saliente = plato();
  const track = getTrack(id);
  if (!track || !entrante.nodos || !saliente.nodos) return false;

  encadenando = true;
  // Lo que estaba preparado pasa a sonar: deja de ser «lo que preparas».
  if (platoConPreparada === 1 - activo) platoConPreparada = null;
  // Cada mezcla lleva su número. Una transición dura quince segundos y deja
  // temporizadores por el camino; si se corta a la mitad y se lanza otra, los
  // de la primera llegan tarde y pararían el plato de la segunda.
  mezclaActual += 1;
  const mia = mezclaActual;
  const esMia = () => encadenando && mezclaActual === mia;

  // Si ya estaba preparado, no se vuelve a cargar: el archivo está abierto y
  // con búfer, y entrar sin el retardo de una carga es media mezcla ganada.
  const yaPreparado = entrante.id === id && entrante.el.currentSrc && entrante.el.readyState >= 1;
  if (!yaPreparado) {
    entrante.id = id;
    entrante.el.src = window.pletina.media.track(id);
  }

  // La mezcla manda sobre el tempo: a partir de aquí el reproductor va al que
  // ha decidido el plan, y el panel de sonido lo refleja.
  const velEntrante = plan.velocidad || 1;
  tempo = { velocidad: velEntrante, preservarTono: Boolean(estirarTiempo), origen: 'mezcla' };
  // Después del `src`, nunca antes: asignar la fuente relanza el algoritmo de
  // carga del elemento y eso devuelve `playbackRate` a 1. El ajuste de tempo se
  // perdía entero y la mezcla salía desincronizada aunque el plan fuese
  // correcto. Se repite con los metadatos por si la carga vuelve a pisarlo.
  const preparar = () => aplicarTempo(entrante);
  preparar();
  // Solo cuando de verdad va a haber una carga: sobre un plato ya precargado el
  // evento no llega nunca y el oyente se quedaba puesto, uno por mezcla.
  if (!yaPreparado) entrante.el.addEventListener('loadedmetadata', preparar, { once: true });

  motor.limpiarPlato(entrante.nodos);
  fijarGanancia(entrante, 0);

  // El pinchazo cae en un inicio de compás de la que está sonando: eso es lo
  // que hace que los bombos de las dos canciones caigan juntos. `arranque` va
  // en tiempo de la canción; para saber cuánto falta de reloj hay que dividir
  // por la velocidad a la que se está reproduciendo.
  const velSaliente = saliente.el.playbackRate || 1;
  const posicion = saliente.el.currentTime || 0;
  const espera = Math.max(0, ((Number(plan.arranque) || posicion) - posicion) / velSaliente);

  const platos = { entrante, saliente };
  const t0 = motor.tiempo + Math.max(0.05, espera);
  for (const evento of plan.eventos) programar(platos, evento, t0);

  // La entrante arranca antes del pinchazo cuando tiene recorrido por delante:
  // así el elemento ya va sonando (en silencio) y llega al compás sin arrastrar
  // el retardo de `play()`. Si no lo tiene, se espera y se corrige el desfase.
  const margen = Math.min(espera, Math.max(0, plan.inicioEntrante / velEntrante));
  const arrancar = () => {
    if (!esMia()) return;
    const retraso = Math.max(0, motor.tiempo - (t0 - margen));
    try {
      entrante.el.currentTime = Math.max(0, plan.inicioEntrante - (margen - retraso) * velEntrante);
    } catch {
      /* aún sin metadatos: entrará por su principio */
    }
    preparar();
    const promesa = entrante.el.play();
    if (promesa?.catch) promesa.catch(() => cancelarFundido());
  };
  const retardoArranque = Math.max(0, espera - margen);
  if (retardoArranque > 0.02) setTimeout(arrancar, retardoArranque * 1000);
  else arrancar();

  /**
   * El empujoncito.
   *
   * Colocar el plato en su sitio no basta: entre pedirle una posición y que
   * empiece a sonar se le van unos milisegundos, y veinte milisegundos ya se
   * oyen como un eco. Así que un rato después de arrancar se mide el desfase
   * real entre las dos rejillas y se corrige como lo haría un pinchadiscos:
   * acelerando un pelo hasta recuperarlo, no dando un salto.
   */
  const ajustarFase = () => {
    if (!esMia() || entrante.id !== id) return;
    const velSalienteAhora = saliente.el.playbackRate || 1;
    const esperado = plan.inicioEntrante
      + ((saliente.el.currentTime - plan.arranque) * velEntrante) / velSalienteAhora;
    const error = esperado - entrante.el.currentTime;
    // Menos de tres milisegundos no se oye; más de ciento cincuenta no es un
    // retraso de arranque, es otra cosa, y ahí corregir sería empeorar.
    if (!Number.isFinite(error) || Math.abs(error) < 0.003 || Math.abs(error) > 0.15) return;
    const empuje = 0.02 * Math.sign(error);
    const segundos = Math.min(2, Math.abs(error) / (velEntrante * 0.02));
    entrante.el.playbackRate = velEntrante * (1 + empuje);
    setTimeout(() => {
      // El empujón hay que deshacerlo aunque la mezcla ya haya terminado, o el
      // plato se queda un 2 % rápido el resto de la canción. Pero solo si sigue
      // mandando este tempo: si alguien ha tocado el mando mientras tanto, el
      // suyo gana.
      const suyo = tempo.origen === 'mezcla' && tempo.velocidad === velEntrante;
      if (entrante.id === id && suyo) entrante.el.playbackRate = velEntrante;
    }, segundos * 1000);
  };
  setTimeout(ajustarFase, (retardoArranque + 0.35) * 1000);

  /**
   * El mando pasa al otro plato EN EL PINCHAZO, no al programar la mezcla.
   *
   * Entre pulsar «Mezclar ahora» y el pinchazo pueden pasar siete segundos en
   * los que no ha sonado nada nuevo. Cambiando el mando al programar, en esa
   * ventana el Espacio no pausaba: se llevaba por delante la canción que sonaba
   * y saltaba a la siguiente, y la pantalla enseñaba el título de una canción
   * que todavía no había entrado. Cuesta imaginar algo que se sienta más raro
   * que pulsar pausa y que cambie la canción.
   */
  const darElMando = () => {
    if (!esMia()) return;
    activo = 1 - activo;
    state.currentId = id;
    avisadoFinal = false;
    hooks.onTrack(track);
    setMediaSession(track);
  };
  if (espera > 0.05) setTimeout(darElMando, espera * 1000);
  else darElMando();
  hooks.onMezcla?.({ plan, en: 'inicio' });

  const finaliza = (espera + plan.duracion + 0.25) * 1000;
  setTimeout(() => {
    if (!esMia()) return;
    encadenando = false;
    saliente.el.pause();
    saliente.el.removeAttribute('src');
    saliente.id = null;
    motor.limpiarPlato(saliente.nodos);
    motor.limpiarPlato(plato().nodos);
    hooks.onMezcla?.({ plan, en: 'fin' });
  }, Math.max(400, finaliza));
  return true;
}

/** Traduce un evento del plan a automatización sobre el parámetro que toque. */
function programar({ entrante, saliente }, evento, t0) {
  const plato = evento.plato === 'entrante' ? entrante : saliente;
  const nodos = plato?.nodos;
  if (!nodos) return;
  const parametro = evento.parametro === 'ganancia'
    ? nodos.ganancia.gain
    : nodos[evento.parametro]?.gain;
  if (!parametro) return;

  const cuando = t0 + evento.en;
  const rampa = Math.max(0.01, Number(evento.rampa) || 0.01);

  if (evento.curva === 'potencia') {
    // Igual potencia: un cruce lineal hunde el volumen justo a la mitad.
    const subiendo = (evento.a ?? 1) > (evento.desde ?? 1);
    parametro.cancelScheduledValues(cuando);
    if (evento.desde !== undefined) parametro.setValueAtTime(evento.desde, cuando);
    parametro.setValueCurveAtTime(curva(!subiendo), cuando, rampa);
    return;
  }

  parametro.cancelScheduledValues(cuando);
  // `desde` lo dice el plan. Anclar en `parametro.value` era anclar en el valor
  // de AHORA, no en el que tendrá cuando le toque: la rampa salía del sitio
  // equivocado y lo que debía ser un tiempo de transición era un salto.
  parametro.setValueAtTime(evento.desde !== undefined ? evento.desde : parametro.value, cuando);
  parametro.linearRampToValueAtTime(evento.a, cuando + rampa);
}

/**
 * Encadenado simple: el fundido de toda la vida, sin ajuste de tempo ni cambio
 * de graves. Lo usa el reproductor cuando el mezclador está apagado.
 */
export function encadenar(id, { segundos = 6 } = {}) {
  if (!motor || encadenando) return false;
  const entrante = otro();
  const saliente = plato();
  const track = getTrack(id);
  if (!track) return false;

  encadenando = true;
  mezclaActual += 1;
  const mio = mezclaActual;
  const esMio = () => encadenando && mezclaActual === mio;
  entrante.id = id;
  entrante.el.src = window.pletina.media.track(id);
  aplicarTempo(entrante);
  motor.limpiarPlato(entrante.nodos);
  fijarGanancia(entrante, 0);
  const promesa = entrante.el.play();
  if (promesa?.catch) promesa.catch(() => cancelarFundido());

  const ahora = motor.tiempo;
  const sale = ganancia(saliente);
  const entra = ganancia(entrante);
  if (sale && entra) {
    sale.setValueCurveAtTime(curva(true), ahora, segundos);
    entra.setValueCurveAtTime(curva(false), ahora, segundos);
  }

  activo = 1 - activo;
  state.currentId = id;
  avisadoFinal = false;
  hooks.onTrack(track);
  setMediaSession(track);

  setTimeout(() => {
    // Con su número de mezcla, como la transición larga. Sin él, el
    // temporizador de un encadenado viejo cerraba el de otro: la ganancia de la
    // entrante saltaba a uno a mitad del fundido y la saliente se quedaba
    // sonando a volumen cero hasta el final del archivo, decodificando.
    if (!esMio()) return;
    encadenando = false;
    saliente.el.pause();
    saliente.el.removeAttribute('src');
    saliente.id = null;
    fijarGanancia(plato(), 1);
  }, segundos * 1000 + 120);
  return true;
}

/** Curva de igual potencia con 64 puntos: sube o baja según se le pida. */
function curva(bajando) {
  const puntos = new Float32Array(64);
  for (let i = 0; i < puntos.length; i += 1) {
    const t = i / (puntos.length - 1);
    puntos[i] = Math.cos((bajando ? t : 1 - t) * 0.5 * Math.PI);
  }
  return puntos;
}

/* ------------------------------------------------------- control del sistema */

function setMediaSession(track) {
  if (!('mediaSession' in navigator) || !track) return;
  try {
    const artwork = track.coverId
      ? [{ src: window.pletina.media.cover(track.coverId), sizes: '512x512', type: 'image/jpeg' }]
      : [];
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album || '',
      artwork,
    });
  } catch {
    /* algunos sistemas no exponen la sesión de medios */
  }
}

export function bindMediaSession({ next, prev }) {
  if (!('mediaSession' in navigator)) return;
  const set = (action, handler) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      /* acción no soportada */
    }
  };
  set('play', start);
  set('pause', pause);
  set('nexttrack', next);
  set('previoustrack', prev);
  set('seekbackward', () => seekBy(-10));
  set('seekforward', () => seekBy(10));
  set('seekto', (details) => {
    if (details.seekTime != null) seekTo(details.seekTime);
  });
  set('stop', stop);
}

/* ------------------------------------------------------------------ eventos */

const esActivo = (evento) => evento.target === plato().el;

for (const p of platos) {
  const { el } = p;

  el.addEventListener('play', (evento) => {
    if (!esActivo(evento)) return;
    state.playing = true;
    fallos = 0;
    hooks.onPlayState(true);
  });

  el.addEventListener('pause', (evento) => {
    if (!esActivo(evento) || encadenando) return;
    state.playing = false;
    hooks.onPlayState(false);
    hooks.onPositionSave(state.currentId, el.currentTime);
  });

  el.addEventListener('ended', (evento) => {
    // El plato que se apaga durante un cruce no debe adelantar la cola.
    if (!esActivo(evento) || encadenando) return;
    hooks.onEnded();
  });

  el.addEventListener('timeupdate', (evento) => {
    if (!esActivo(evento)) return;
    hooks.onTick(el.currentTime, el.duration);

    const restante = ((el.duration || 0) - el.currentTime) / (el.playbackRate || 1);
    if (!avisadoFinal && !encadenando && Number.isFinite(restante) && restante > 0) {
      const margen = hooks.margenDeFundido?.() ?? 0;
      if (margen > 0 && restante <= margen) {
        avisadoFinal = true;
        hooks.onCercaDelFinal();
      }
    }

    const ahora = Date.now();
    if (ahora - guardado > 5000) {
      guardado = ahora;
      hooks.onPositionSave(state.currentId, el.currentTime);
    }
  });

  el.addEventListener('loadedmetadata', (evento) => {
    if (!esActivo(evento)) return;
    hooks.onTick(el.currentTime, el.duration);
    const track = getTrack(state.currentId);
    // La duración medida gana a la etiqueta: los MP3 de tasa variable mienten.
    if (track && Number.isFinite(el.duration) && Math.abs((track.duration || 0) - el.duration) > 1) {
      track.duration = el.duration;
      window.pletina.track.patch(track.id, { duration: el.duration });
    }
  });

  el.addEventListener('error', (evento) => {
    if (!esActivo(evento) || !state.currentId) return;
    fallos += 1;
    const track = getTrack(state.currentId);
    if (fallos > 4) {
      toast('Varias canciones seguidas han fallado. Revisa si el disco sigue conectado.');
      fallos = 0;
      return;
    }
    toast(`No he podido reproducir «${track?.title ?? 'esa canción'}». Paso a la siguiente.`);
    hooks.onError(state.currentId);
  });
}
