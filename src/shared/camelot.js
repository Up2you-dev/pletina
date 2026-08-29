/**
 * La rueda: cómo se llaman las tonalidades en una cabina.
 *
 * «La menor» es correcto y no sirve para nada a las tres de la mañana. Lo que
 * usa todo el mundo desde hace veinte años es la rueda de Camelot: un número
 * del uno al doce y una letra —A para las menores, B para las mayores—, puestos
 * de modo que dos casillas que pegan quedan al lado. Con eso, decidir si dos
 * canciones se pueden pinchar seguidas es contar hasta uno en vez de saberse el
 * círculo de quintas.
 *
 *   8B = Do mayor · 8A = La menor · 9B = Sol mayor · 5A = Do menor
 *
 * Y de paso Open Key, que es la misma rueda girada cuatro puestos y con `d`
 * y `m` en vez de letras: la usan Traktor y Mixed In Key.
 *
 * Aquí solo hay aritmética de la rueda. Ni audio ni pantalla: se prueba sola.
 */

/** El cifrado americano, en sostenidos, que es como lo escribe el análisis. */
const SOSTENIDOS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** Y en bemoles, que es como lo escriben rekordbox y media discografía. */
const BEMOLES = { Db: 1, Eb: 3, Gb: 6, Ab: 8, Bb: 10, Fb: 4, Cb: 11 };

/**
 * Lee un cifrado y devuelve su clase de altura y su modo.
 *
 * Permisivo a propósito: esto lee tanto lo que escribe el análisis (`Am`) como
 * lo que trae un archivo ajeno (`A min`, `Abm`, `F#maj`, `Dbm`). Un cifrado que
 * no se entiende devuelve null y quien llama enseña la tonalidad tal cual, que
 * es mejor que inventarse una casilla de la rueda.
 */
export function leerCifrado(cifrado) {
  if (typeof cifrado !== 'string') return null;
  const limpio = cifrado.trim().replace(/\s+/g, ' ');
  if (!limpio) return null;
  const partes = /^([A-Ga-g])([#♯b♭]?)\s*(.*)$/.exec(limpio);
  if (!partes) return null;
  const [, letra, alteracion, resto] = partes;
  const nombre = letra.toUpperCase() + (alteracion === '♯' ? '#' : alteracion === '♭' ? 'b' : alteracion);
  const clase = nombre.endsWith('b')
    ? BEMOLES[nombre]
    : SOSTENIDOS.indexOf(nombre);
  if (!(clase >= 0)) return null;
  const cola = resto.toLowerCase().replace(/[\s.]/g, '');
  // Menor es lo que hay que reconocer; todo lo demás —vacío, `maj`, `mayor`—
  // es mayor. `m`, `min`, `minor`, `menor` y `-` son las formas que se ven.
  const menor = cola === 'm' || cola === '-' || cola.startsWith('min') || cola.startsWith('men');
  return { clase, menor };
}

/** El número de la rueda (1-12) de una tonalidad mayor. */
const numeroMayor = (clase) => ((7 + 7 * clase) % 12) + 1;

/**
 * La casilla de Camelot de un cifrado: `{ numero, letra }`, o null.
 *
 * Una menor comparte número con su relativa mayor, que está tres semitonos por
 * encima: La menor y Do mayor son 8A y 8B. Eso es lo que hace que la rueda
 * funcione.
 */
export function casilla(cifrado) {
  const leido = leerCifrado(cifrado);
  if (!leido) return null;
  const { clase, menor } = leido;
  return {
    numero: numeroMayor(menor ? (clase + 3) % 12 : clase),
    letra: menor ? 'A' : 'B',
  };
}

/** `Am` → `8A`. Cadena vacía si el cifrado no se entiende. */
export function camelot(cifrado) {
  const punto = casilla(cifrado);
  return punto ? `${punto.numero}${punto.letra}` : '';
}

/** `Am` → `5m`, en la notación de Open Key. */
export function openKey(cifrado) {
  const punto = casilla(cifrado);
  if (!punto) return '';
  // La misma rueda girada: 8B de Camelot es 1d de Open Key.
  const numero = ((punto.numero - 8 + 12) % 12) + 1;
  return `${numero}${punto.letra === 'A' ? 'm' : 'd'}`;
}

/**
 * Qué relación hay entre dos tonalidades, dicha como se dice pinchando.
 *
 * `salto` es cuántos puestos hay que moverse en la rueda —una vuelta completa
 * son doce— y `letra` si además hay que cambiar de mayor a menor. De ahí sale
 * todo lo demás: pegan las que no se mueven, las que se mueven un puesto y las
 * que solo cambian de letra.
 */
export function relacionArmonica(a, b) {
  const uno = casilla(a);
  const dos = casilla(b);
  if (!uno || !dos) return null;
  const bruto = (dos.numero - uno.numero + 12) % 12;
  // De −5 a +6: moverse once puestos a la derecha es moverse uno a la izquierda.
  const salto = bruto > 6 ? bruto - 12 : bruto;
  const cambiaLetra = uno.letra !== dos.letra;
  if (salto === 0 && !cambiaLetra) return { salto, cambiaLetra, clase: 'misma', etiqueta: 'misma tonalidad' };
  if (salto === 0) return { salto, cambiaLetra, clase: 'relativa', etiqueta: 'relativa' };
  if (!cambiaLetra && Math.abs(salto) === 1) {
    return { salto, cambiaLetra, clase: 'vecina', etiqueta: salto > 0 ? 'vecina · +1' : 'vecina · −1' };
  }
  // El salto de dos puestos hacia arriba es el truco de toda la vida para
  // levantar una sesión: no es vecina, pero se oye bien y es intencionado.
  if (!cambiaLetra && salto === 2) return { salto, cambiaLetra, clase: 'energia', etiqueta: 'sube la energía' };
  return { salto, cambiaLetra, clase: 'lejana', etiqueta: '' };
}

/** ¿Se pueden pinchar seguidas sin que choque? La misma, la vecina o la relativa. */
export function pegan(a, b) {
  const relacion = relacionArmonica(a, b);
  if (!relacion) return false;
  return relacion.clase === 'misma' || relacion.clase === 'relativa' || relacion.clase === 'vecina';
}

/**
 * Cuánto se alejan dos tonalidades, de 0 a 3, para poder ordenar por ello.
 *
 * No es una distancia geométrica: es el orden en el que las elegiría alguien
 * pinchando. La misma primero, luego la vecina y la relativa, luego el salto de
 * energía, y al final todo lo demás.
 */
export function distanciaArmonica(a, b) {
  const relacion = relacionArmonica(a, b);
  if (!relacion) return null;
  if (relacion.clase === 'misma') return 0;
  if (relacion.clase === 'vecina' || relacion.clase === 'relativa') return 1;
  if (relacion.clase === 'energia') return 2;
  return 3;
}

/**
 * Cómo se enseña una tonalidad en la cabina: la casilla primero, el nombre
 * detrás. La casilla es la que se usa para decidir y por eso va delante.
 */
export function etiquetaDeTono({ key = '', tonalidad = '' } = {}) {
  const rueda = camelot(key);
  if (!rueda) return tonalidad || key || '';
  return `${rueda} · ${key}`;
}
