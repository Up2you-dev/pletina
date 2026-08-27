import {
  franja, lineasDeRejilla, ventana, xDeSegundo,
} from '../../shared/onda-vista.js';

/**
 * El visor de ondas.
 *
 * Tres bandas, un color cada una: graves, medios y agudos. Es como se dibujan
 * las ondas en las cabinas desde hace quince años, y no es decoración: en una
 * silueta gris no se ve dónde entra el bombo ni dónde se va la voz, y en tres
 * colores se ve de un vistazo. La técnica —tres formas rellenas, la grave
 * detrás y la aguda delante, todas centradas— es la de rekordbox y Serato.
 *
 * Aquí solo se pinta. Las cuentas están en `shared/onda-vista.js`, donde se
 * pueden probar sin pantalla.
 */

/** Alto de cada banda como fracción del alto del lienzo. */
const ESCALA = 0.92;

function colores(canvas) {
  const estilo = getComputedStyle(canvas);
  const leer = (nombre, porDefecto) => estilo.getPropertyValue(nombre).trim() || porDefecto;
  return {
    grave: leer('--onda-grave', '#4f46e5'),
    medio: leer('--onda-medio', '#f59e0b'),
    agudo: leer('--onda-agudo', '#e5e7eb'),
    fondo: leer('--onda-fondo', 'transparent'),
    rejilla: leer('--onda-rejilla', 'rgba(255,255,255,.28)'),
    acento: leer('--accent', '#4f46e5'),
    senal: leer('--signal', '#f59e0b'),
  };
}

/**
 * Ajusta el lienzo a su tamaño real en pantalla. Sin esto, en una pantalla de
 * densidad doble la onda sale borrosa y las líneas de la rejilla, gordas.
 */
export function ajustarLienzo(canvas) {
  const razon = window.devicePixelRatio || 1;
  const ancho = Math.max(1, Math.floor(canvas.clientWidth));
  const alto = Math.max(1, Math.floor(canvas.clientHeight));
  if (canvas.width !== ancho * razon || canvas.height !== alto * razon) {
    canvas.width = ancho * razon;
    canvas.height = alto * razon;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(razon, 0, 0, razon, 0, 0);
  ctx.clearRect(0, 0, ancho, alto);
  return { ctx, ancho, alto };
}

/** Las tres bandas, una encima de otra: la grave detrás, la aguda delante. */
function pintarBandas(ctx, columnas, {
  ancho, alto, paleta, ganancia = 1, apagada = null,
}) {
  const medio = alto / 2;
  const base = ctx.globalAlpha;
  for (const [banda, color] of [['grave', paleta.grave], ['medio', paleta.medio], ['agudo', paleta.agudo]]) {
    const tira = columnas[banda];
    if (!tira?.length) continue;
    // Una banda que está fuera del sonido se pinta a media luz: se sigue viendo
    // la canción, pero se ve que no suena.
    ctx.globalAlpha = banda === apagada ? base * 0.25 : base;
    const camino = new Path2D();
    let hay = false;
    for (let x = 0; x < ancho; x += 1) {
      const valor = tira[x];
      if (!valor) continue;
      const altura = Math.max(1, ((valor / 255) * alto * ESCALA * ganancia));
      camino.rect(x, medio - altura / 2, 1, altura);
      hay = true;
    }
    if (!hay) continue;
    ctx.fillStyle = color;
    ctx.fill(camino);
  }
  ctx.globalAlpha = base;
}

/**
 * Vista general de la canción entera: para ver la estructura y saltar por ella.
 */
export function pintarGeneral(canvas, ondas, {
  posicion = 0, duracion = 0, zona = null, marcas = [], apagado = false,
} = {}) {
  const { ctx, ancho, alto } = ajustarLienzo(canvas);
  const paleta = colores(canvas);
  const largo = duracion || ondas?.duracion || 0;
  if (!ondas || !largo) return;

  const vista = { desde: 0, hasta: largo, ancho };
  const opciones = { ...vista, fps: ondas.fps };
  ctx.globalAlpha = apagado ? 0.45 : 1;
  pintarBandas(ctx, {
    grave: franja(ondas.grave, opciones),
    medio: franja(ondas.medio, opciones),
    agudo: franja(ondas.agudo, opciones),
  }, { ancho, alto, paleta, ganancia: 0.9 });
  ctx.globalAlpha = 1;

  // La zona de la transición, sombreada: se ve cuánto queda para el pinchazo.
  if (zona && zona.hasta > zona.desde) {
    const x = xDeSegundo(zona.desde, vista);
    const w = Math.max(2, xDeSegundo(zona.hasta, vista) - x);
    ctx.fillStyle = paleta.senal;
    ctx.globalAlpha = 0.18;
    ctx.fillRect(x, 0, w, alto);
    ctx.globalAlpha = 1;
  }

  for (const marca of marcas) {
    if (!(marca.segundo >= 0) || marca.segundo > largo) continue;
    ctx.fillStyle = marca.color || paleta.senal;
    ctx.fillRect(Math.round(xDeSegundo(marca.segundo, vista)), 0, 2, alto);
  }

  // Lo ya escuchado, apagado.
  const x = xDeSegundo(Math.max(0, Math.min(largo, posicion)), vista);
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.fillRect(0, 0, x, alto);
  ctx.fillStyle = paleta.acento;
  ctx.fillRect(Math.round(x) - 1, 0, 2, alto);
}

/**
 * Vista ampliada, con la cabeza en el centro y la rejilla encima.
 *
 * Las dos vistas ampliadas de los dos platos comparten escala de tiempo, así
 * que cuando dos canciones van cuadradas sus líneas de compás caen a la misma
 * altura. Eso es lo que se mira al mezclar: no el número, el dibujo.
 */
export function pintarZoom(canvas, ondas, {
  centro = 0, segundos = 8, rejilla = null, marcas = [], apagado = false, sinGraves = false,
} = {}) {
  const { ctx, ancho, alto } = ajustarLienzo(canvas);
  const paleta = colores(canvas);
  const { desde, hasta } = ventana(centro, segundos);
  const vista = { desde, hasta, ancho };

  if (ondas) {
    const opciones = { ...vista, fps: ondas.fps };
    ctx.globalAlpha = apagado ? 0.5 : 1;
    pintarBandas(ctx, {
      grave: franja(ondas.grave, opciones),
      medio: franja(ondas.medio, opciones),
      agudo: franja(ondas.agudo, opciones),
      // Con los graves fuera se pintan a media luz: lo que se ve es lo que se oye.
    }, { ancho, alto, paleta, apagada: sinGraves ? 'grave' : null });
    ctx.globalAlpha = 1;
  }

  // Rejilla: la frase se ve, el compás se nota y el golpe solo acompaña.
  for (const linea of lineasDeRejilla(rejilla, { desde, hasta })) {
    const x = Math.round(xDeSegundo(linea.segundo, vista)) + 0.5;
    ctx.strokeStyle = linea.tipo === 'frase' ? paleta.senal : paleta.rejilla;
    ctx.globalAlpha = linea.tipo === 'frase' ? 0.9 : linea.tipo === 'compas' ? 0.55 : 0.2;
    ctx.lineWidth = linea.tipo === 'frase' ? 2 : 1;
    ctx.beginPath();
    // El golpe suelto solo asoma por abajo; el uno cruza la onda entera.
    ctx.moveTo(x, linea.tipo === 'golpe' ? alto * 0.78 : 0);
    ctx.lineTo(x, alto);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (const marca of marcas) {
    const x = xDeSegundo(marca.segundo, vista);
    if (x < -4 || x > ancho + 4) continue;
    ctx.fillStyle = marca.color || paleta.senal;
    ctx.fillRect(Math.round(x) - 1, 0, 2, alto);
    if (marca.etiqueta) {
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(marca.etiqueta, Math.round(x) + 4, 11);
    }
  }

  // La cabeza lectora, en el centro y siempre visible.
  const centroX = Math.round(ancho / 2);
  ctx.fillStyle = paleta.acento;
  ctx.fillRect(centroX - 1, 0, 2, alto);
}

/** Y en una vista general. */
export function segundoEnLaGeneral(canvas, evento, duracion) {
  const caja = canvas.getBoundingClientRect();
  const proporcion = Math.max(0, Math.min(1, (evento.clientX - caja.left) / caja.width));
  return proporcion * duracion;
}
