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
  // Los valores por defecto son los del tema claro de verdad. Antes eran de una
  // paleta que la aplicación no usa, así que el día que una variable no
  // resolviera la rejilla saldría blanca sobre fondo claro y en silencio.
  return {
    grave: leer('--onda-grave', '#3A3FD4'),
    medio: leer('--onda-medio', '#D08A2A'),
    agudo: leer('--onda-agudo', '#8C8AA3'),
    fondo: leer('--onda-fondo', '#EDEBF5'),
    rejilla: leer('--onda-rejilla', '#141320'),
    frase: leer('--onda-frase', '#C4344A'),
    acento: leer('--accent', '#3A3FD4'),
    senal: leer('--signal', '#9C5A0C'),
  };
}

/**
 * Una línea con halo, para que se lea encima de la onda.
 *
 * Este es el arreglo de «no se ven las rejillas». Una línea traslúcida sobre una
 * onda densa tiene un contraste de 1,1:1 —o sea, ninguno—, y en tema oscuro la
 * línea de frase era exactamente el mismo color que la banda de medios. Con un
 * trazo ancho del color del fondo debajo, la línea se lee contra su halo y el
 * halo contra la onda, y eso funciona encima de cualquier banda.
 */
function lineaConHalo(ctx, x, desde, hasta, { color, alfa = 1, grosor = 1, halo }) {
  ctx.beginPath();
  ctx.moveTo(x, desde);
  ctx.lineTo(x, hasta);
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = halo;
  ctx.lineWidth = grosor + 3;
  ctx.stroke();
  ctx.globalAlpha = alfa;
  ctx.strokeStyle = color;
  ctx.lineWidth = grosor;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Y un número con su halo, por lo mismo. */
function numeroConHalo(ctx, texto, x, y, { color, halo }) {
  ctx.font = '600 10px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.lineWidth = 3;
  ctx.strokeStyle = halo;
  ctx.globalAlpha = 0.9;
  ctx.strokeText(texto, x, y);
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.fillText(texto, x, y);
  ctx.textBaseline = 'alphabetic';
}

/**
 * Ajusta el lienzo a su tamaño real en pantalla. Sin esto, en una pantalla de
 * densidad doble la onda sale borrosa y las líneas de la rejilla, gordas.
 */
export function ajustarLienzo(canvas) {
  const razon = window.devicePixelRatio || 1;
  const ancho = Math.max(1, Math.floor(canvas.clientWidth));
  const alto = Math.max(1, Math.floor(canvas.clientHeight));
  // Comparando contra el valor YA redondeado. Con escalado fraccionario —un
  // portátil al 125 %— `ancho * razon` no es entero, el navegador lo trunca al
  // asignarlo y la comparación nunca coincidía: se reasignaba el búfer de los
  // cuatro lienzos sesenta veces por segundo, justo en la pantalla que tiene
  // que ir fina.
  const anchoReal = Math.round(ancho * razon);
  const altoReal = Math.round(alto * razon);
  if (canvas.width !== anchoReal || canvas.height !== altoReal) {
    canvas.width = anchoReal;
    canvas.height = altoReal;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(razon, 0, 0, razon, 0, 0);
  ctx.clearRect(0, 0, ancho, alto);
  return { ctx, ancho, alto };
}

/**
 * Un aviso en medio del lienzo.
 *
 * Un hueco vacío no dice nada: si una canción no tiene onda que dibujar, hay
 * que decir por qué y qué hacer, ahí mismo y no en un menú.
 */
function escribirEnMedio(ctx, texto, { ancho, alto, paleta }) {
  if (!texto) return;
  ctx.fillStyle = paleta.agudo;
  ctx.globalAlpha = 0.85;
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(texto, ancho / 2, alto / 2);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = 1;
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
  posicion = 0, duracion = 0, zona = null, marcas = [], apagado = false, mensaje = '',
  rejilla = null,
} = {}) {
  const { ctx, ancho, alto } = ajustarLienzo(canvas);
  const paleta = colores(canvas);
  const largo = duracion || ondas?.duracion || 0;
  if (!ondas || !largo) {
    escribirEnMedio(ctx, mensaje, { ancho, alto, paleta });
    return;
  }

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

  // Las frases, en la vista de la canción entera: es la estructura, y es lo que
  // permite saltar a un sitio sabiendo dónde se cae. Aquí solo las frases: los
  // compases a esta escala serían una mancha.
  for (const linea of lineasDeRejilla(rejilla, { desde: 0, hasta: largo, maximo: 4096 })) {
    if (linea.tipo !== 'frase') continue;
    lineaConHalo(ctx, Math.round(xDeSegundo(linea.segundo, vista)) + 0.5, 0, alto, {
      color: paleta.frase, alfa: 0.5, grosor: 1, halo: paleta.fondo,
    });
  }

  for (const marca of marcas) {
    if (!(marca.segundo >= 0) || marca.segundo > largo) continue;
    lineaConHalo(ctx, Math.round(xDeSegundo(marca.segundo, vista)) + 0.5, 0, alto, {
      color: marca.color || paleta.senal, alfa: 1, grosor: 2, halo: paleta.fondo,
    });
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
  mensaje = '',
} = {}) {
  const { ctx, ancho, alto } = ajustarLienzo(canvas);
  const paleta = colores(canvas);
  const { desde, hasta } = ventana(centro, segundos);
  const vista = { desde, hasta, ancho };

  if (!ondas) escribirEnMedio(ctx, mensaje, { ancho, alto, paleta });
  if (ondas) {
    const opciones = { ...vista, fps: ondas.fps };
    ctx.globalAlpha = apagado ? 0.72 : 1;
    pintarBandas(ctx, {
      grave: franja(ondas.grave, opciones),
      medio: franja(ondas.medio, opciones),
      agudo: franja(ondas.agudo, opciones),
      // Con los graves fuera se pintan a media luz: lo que se ve es lo que se oye.
    }, { ancho, alto, paleta, apagada: sinGraves ? 'grave' : null });
    ctx.globalAlpha = 1;
  }

  // Rejilla: la frase manda, el compás se ve y el golpe acompaña. Todo con
  // halo, que es lo único que la hace legible encima de una onda densa.
  const lineas = lineasDeRejilla(rejilla, { desde, hasta });
  for (const linea of lineas) {
    const x = Math.round(xDeSegundo(linea.segundo, vista)) + 0.5;
    const esUno = linea.tipo !== 'golpe';
    const esFrase = linea.tipo === 'frase';
    lineaConHalo(ctx, x, esUno ? 0 : 0, esUno ? alto : alto * 0.16, {
      color: esFrase ? paleta.frase : paleta.rejilla,
      alfa: esFrase ? (linea.medida ? 1 : 0.8) : linea.tipo === 'compas' ? 0.9 : 0.5,
      grosor: esFrase ? 2 : 1,
      halo: paleta.fondo,
    });
    // El golpe suelto asoma también por abajo, sin cruzar la onda.
    if (!esUno) {
      lineaConHalo(ctx, x, alto * 0.84, alto, {
        color: paleta.rejilla, alfa: 0.5, grosor: 1, halo: paleta.fondo,
      });
    }
  }
  // Y el número del compás encima de su línea: «señalar los compases» es esto,
  // poder contarlos sin llevar la cuenta con el dedo.
  if (alto > 44) {
    for (const linea of lineas) {
      if (linea.tipo === 'golpe' || linea.compas == null) continue;
      numeroConHalo(ctx, String(linea.compas), Math.round(xDeSegundo(linea.segundo, vista)) + 4, 2, {
        color: linea.tipo === 'frase' ? paleta.frase : paleta.rejilla,
        halo: paleta.fondo,
      });
    }
  }

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
