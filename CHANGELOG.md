# Registro de cambios

Las versiones siguen [SemVer](https://semver.org/lang/es/). Cada una se
construye desde la pestaña *Actions* del repositorio; una etiqueta `v1.2.3`
además publica los instaladores sueltos en la página de versiones.

## 4.1.0 — 2026-08-27

Tres quejas, tres arreglos: las ondas no se veían, había teclas que no hacían
nada y el análisis era mediocre cuadrando. Las tres tenían causa, y ninguna era
la que parecía.

### Cuadrar y analizar

- **El tempo sale en su octava.** El detector se equivocaba a menudo del doble o
  de la mitad —en una balada de bombo flojo decía 144 en vez de 72; en un garage
  con el bombo al uno y al tres, 65 en vez de 130— y daba igual lo fino que se
  afinase después: con la octava cambiada la mezcla no cuadra jamás y el número
  que enseñaba la aplicación era sencillamente falso. Ahora se prueban el doble,
  la mitad y los tercios de por medio, y gana la que más **contraste** saca:
  cuánta más energía hay en los golpes que entre golpe y golpe. Una rejilla a la
  mitad cae solo sobre golpes fuertes y saca buena media, pero el punto medio
  entre sus golpes cae justo encima de los que se ha saltado, y ahí se delata.
- **La octava se decide con el grupo entero y la fase con el bombo.** Cada cosa
  con lo que sabe: en la banda grave, un ritmo de bombo al uno y al tres parece
  ir a la mitad de velocidad de lo que va; y el bombo es el que marca el
  instante exacto, que es lo que se oye cuando dos canciones no caen juntas.
- **Ya no se pierde música por «poca confianza».** Antes, si el detector dudaba,
  la canción se quedaba sin rejilla y sin poder mezclarse: el peor final. Ahora
  quien decide si hay pulso es la rejilla, que mira la canción entera; un
  hip-hop de bombo espaciado se analiza como cualquier otra cosa.
- **Y la confianza dice la verdad.** Antes salía «1» hasta cuando el tempo
  estaba al doble. Ahora es lo que destacan los golpes por lo bien que un solo
  tempo explica la canción de punta a punta, y con eso la cabina avisa: «el
  tempo se mueve · cuadra a ojo», «pulso flojo · repasa la rejilla». Una charla,
  un ambiente o una grabación de campo se quedan sin rejilla, que es lo honesto:
  una rejilla inventada cuadra el pinchazo con la nada.
- **×2 y ÷2 en la cabina.** Hay ritmos que se pueden contar de las dos maneras y
  las dos son ciertas —un drum & bass son 174 o son 87—, así que ninguna máquina
  puede acertar siempre; lo que sí puede es dejar que se le lleve la contraria
  en un clic. No vuelve a analizar nada ni mueve un golpe de sitio: ancla la
  rejilla en el «uno» que ya está puesto y cambia la cuenta.
- Una rejilla corregida a mano queda **al día**: la siguiente versión del
  análisis no la pisa con su propia opinión.
- **Cuánta costumbre.** Cuando la música no rompe el empate lo rompe la
  costumbre, que vive alrededor de las ciento veinte, y cuánto debe pesar está
  medido y no elegido a ojo: con noventa y seis canciones fabricadas —seis
  patrones por dieciséis tempos— el ancho que más acierta es 0,8, y tanto
  abrirlo como cerrarlo empeora. Abierto se escapan los tempos rápidos de kit
  escaso, que salen a la mitad; cerrado se doblan las canciones lentas.
- Medido con música fabricada para la ocasión —bombo, caja, charles, bajo y pad,
  con tempos no redondos y patrones de ocho estilos—: **ocho de ocho en la
  octava buena** y menos de 20 ms de desfase medio, donde antes fallaban tres.
  En el barrido ancho de ochenta canciones, de 62 aciertos a 67; lo que queda
  fuera es medio tiempo de verdad, donde dos personas tampoco se pondrían de
  acuerdo, y para eso está el ×2.
- Lo que **no** se ha metido: un aviso de «octava dudosa». Se midió —la
  distancia hasta la segunda lectura— y avisaba de cuatro de los nueve fallos
  pero también de catorce de los treinta y nueve aciertos. Un aviso que se
  equivoca un tercio de las veces no informa, cansa.

### Las teclas

- **Un mando con el foco ya no secuestra el teclado.** Movías el volumen o un
  mando del ecualizador con el ratón, el foco se quedaba ahí y a partir de ese
  momento no respondía ni el espacio. Cualquier `input` contaba como «estar
  escribiendo»; ahora solo cuenta lo que se escribe de verdad. Las flechas de un
  deslizador siguen siendo suyas, que para eso está.
- **Pero un mando con el foco se queda con lo suyo**: las flechas de un
  deslizador lo mueven y el espacio marca una casilla. Es lo único con lo que se
  puede usar la aplicación sin ratón, y quitárselo para ganar un atajo global
  sería cambiar un teclado que funciona por otro.
- **Un botón pulsado con el ratón devuelve el teclado a la aplicación**, en vez
  de quedarse el espacio para volver a pulsarse solo.
- **Los atajos con Ctrl los atiende también la ventana.** En Windows la barra de
  menú no se ve y sus aceleradores dependen de que el sistema los reparta; ahora
  funcionan siempre, y el menú suelta los suyos para que nada suene dos veces.
- **Teclas de cabina**: `[` y `]` mueven el plato B un compás exacto y `B`
  preescucha. Mientras se escucha no se puede estar con el ratón.
- La ficha de atajos (`Ctrl + /`) lista todo esto, con su apartado de cabina.

### Las ondas

- **Un análisis de la versión anterior ya no cuenta como hecho.** Era la razón
  de que no se vieran: la aplicación daba por analizada una biblioteca sin ondas
  guardadas y no volvía a ofrecer el botón. Ahora vuelve a salir «Analizar N» y
  con eso aparecen.
- **Un hueco sin onda explica por qué**, escrito en el propio lienzo: «sin
  analizar · pulsa Analizar», «sin onda guardada · vuelve a analizarla», «plato
  vacío». Un rectángulo en blanco no dice nada.

### Y de paso

- **«Mezclar ahora» ya no se ofrece cuando no cabe.** A tres segundos del final
  la transición empieza en el siguiente compás, que cae después de la canción:
  se pulsaba el botón y no pasaba nada, sin decir por qué. Ahora el botón se
  apaga y explica que ya no da tiempo.

### Por dentro

- `prueba-rejilla`, una quinta prueba de extremo a extremo que fabrica canciones
  difíciles a propósito, las analiza con el analizador de verdad y comprueba la
  octava, el desfase, la tinta de los cuatro lienzos y que cada tecla llega —al
  elemento que tiene el foco, que es a donde el navegador manda una tecla de
  verdad; mandarla al documento sería probar otra cosa—. Las
  tres quejas de esta versión vivían en la unión entre piezas, que es donde no
  miraba ninguna prueba unitaria.
- Un estudio de grabación de mentira en `test/musica-falsa.js`: bombo, caja,
  charles, bajo y pad, con swing y con tempo que se va. La caja de ritmos de
  antes era demasiado fácil y por eso las pruebas pasaban mientras el análisis
  fallaba.

## 4.0.0 — 2026-08-26

El mezclador deja de ser una pantalla con dos fichas y pasa a ser una **cabina**:
dos platos con sus ondas, uno encima de otro, y tú decidiendo qué entra.

### Se ve

- **Visor de ondas de tres bandas.** Graves en azul, medios en ámbar, agudos en
  gris: es como se dibujan las ondas en las cabinas desde hace quince años, y no
  es decoración. En una silueta gris no se ve dónde entra el bombo ni dónde se
  va la voz; en tres colores se ve de un vistazo. Cada canción tiene dos vistas:
  la general —la canción entera, para ver la estructura y saltar por ella— y la
  ampliada, con la cabeza en el centro y la rejilla de compases encima.
- **Las dos ondas comparten eje de tiempo.** Cuando las dos canciones van
  cuadradas, sus líneas de compás caen a la misma altura de la pantalla. Eso es
  lo que se mira al mezclar: no el número, el dibujo.
- **Y un número, para los incrédulos**: el desfase entre las dos rejillas en
  milisegundos, que se pone en azul cuando está por debajo de doce.
- **La rejilla se dibuja con jerarquía**: la frase se ve, el compás se nota y el
  golpe solo acompaña. Y cuando una canción entra sin graves, su banda grave se
  pinta a media luz: lo que se ve es lo que se oye.

### Se toca

- **Plato B.** Cargas lo que tú quieras —desde las sugerencias, desde el menú de
  cualquier canción— y se queda esperando, colocado por donde la canción empieza
  a sonar de verdad. Se puede preescuchar, mover y quitar. La cola sigue
  estando, pero deja de mandar: eso es lo que separa una cabina de una lista de
  reproducción.
- **Arrastrar una onda es empujar el plato.** En el que suena se traduce en un
  empujón —acelerar o frenar un pelo— porque saltar sonaría a corte; en el que
  preparas, que está parado, se mueve y ya. También con las teclas `,` y `.`.
- **Entrar sin retardo.** Al mezclar, si el plato ya estaba preparado no se
  vuelve a abrir el archivo: entra con el búfer hecho, que es de las cosas que
  más ayudaban a que no cuadrase.
- **Compás adelante y compás atrás**: el plato B se mueve un compás exacto, no
  «un poco».
- **«El uno está aquí»**: corrige la rejilla desde la cabina. El detector
  acierta casi siempre con el pulso y falla más con el uno, y con el uno mal la
  mezcla entra a contratiempo por muy afinado que esté el tempo. Se coloca el
  plato donde de verdad empieza el compás, se pulsa, y queda corregido sin
  volver a analizar nada.
- **Qué pinchar después.** Un abanico de la biblioteca ordenado como lo pensaría
  un pinchadiscos: primero lo que encaja de tonalidad, luego lo que menos hay
  que estirar, y fuera lo que no se puede cuadrar sin que se note.
- **La tecla `M`** lanza la mezcla sin soltar el ratón.

### Por dentro

- Las ondas se calculan al analizar y se guardan en su propia carpeta
  (`ondas/`), un archivo por canción: tres tiras de bytes, una por banda, a
  ciento cincuenta marcos por segundo. Una canción de cinco minutos ocupa ciento
  treinta kilobytes y se dibuja sin decodificar nada. Es regenerable: si se
  borra la carpeta, basta con volver a analizar.
- La cabina se pinta con su propio bucle a la frecuencia de la pantalla, y se
  para sola al salir de ella.
- 270 pruebas. Las cuentas del visor —qué tramo se ve, qué columna le toca a
  cada marco, dónde caen las líneas y cuánto desfase hay entre dos rejillas—
  están separadas del dibujo justamente para poder probarlas sin pantalla.
- `npm run test:mezcla` comprueba además que el análisis deja la onda guardada,
  que los cuatro lienzos se pintan de verdad, que la sugerencia carga en el
  plato B por donde la canción empieza a sonar y que empujar el plato lo mueve.

### Sobre las librerías

Se miró lo que hay hecho antes de escribir: **wavesurfer.js** (BSD-3) es el
estándar para pintar ondas en la web, pero está construido alrededor de su
propio reproductor y de su propia línea de tiempo, y aquí hacen falta dos platos
sobre un eje compartido, estirados por el ajuste de tempo y pintados con el
reloj de audio de la aplicación. **peaks.js** es LGPL y arrastra el mismo
problema de modelo. Así que el visor es propio —doscientas líneas de lienzo—,
pero la técnica de dibujo no se ha inventado: tres formas rellenas centradas,
la grave detrás y la aguda delante, que es como lo hacen rekordbox y Serato y
como se explica en la discusión de la comunidad de wavesurfer.

## 3.1.1 — 2026-08-23

Repaso a fondo del mezclador, buscando lo que se rompe al usarlo de verdad y no
en una transición limpia. Cuatro cosas, todas encontradas probando la aplicación
entera en vez de leyendo el código.

- **La música se paraba a media canción si encadenabas dos mezclas.** Una
  transición deja temporizadores por el camino —el que la cierra, el que corrige
  el desfase—, y los de una mezcla cortada llegaban tarde y paraban el plato de
  la siguiente. Ahora cada mezcla lleva su número y ningún aviso atrasado toca
  la que está sonando.
- **El empujón de sincronía podía quedarse puesto.** Si la transición terminaba
  antes de deshacerlo, el plato se quedaba un 2 % rápido para el resto de la
  canción. Ahora se deshace siempre, salvo que hayas tocado tú el mando de tempo
  mientras tanto.
- **El botón «Mezclar ahora» se ofrecía con la misma canción en la cola** y al
  pulsarlo solo decía que no había podido preparar la mezcla. Ahora lo dice
  antes: «La siguiente de la cola es la que ya está sonando».
- **Lo que le queda a una canción se mide en segundos de reloj, no de archivo.**
  Con el tempo ajustado no son lo mismo, y por eso una transición se recortaba
  un compás sin necesidad —o se pasaba de largo del final—.

- **Los porcentajes, con coma.** «+1,6 %», como se escribe en castellano y como
  ya se escribía «44,1 kHz». Y el panel de sonido decía «+2 %» donde el
  reproductor decía «+1,6 %»: era el mismo número redondeado de dos maneras.
- **Lo que no tiene pulso ya no se reanaliza en cada lote.** Hay música sin
  tempo que agarrar —una charla, un ambiente, un minuto de ruido—; ahora se
  recuerda que se intentó, y solo se repite si lo pides.

También: la nota de la pantalla del mezclador decía que se pincha en compás y
por el principio del archivo, que es lo que hacía la versión anterior.

Y una prueba nueva, `npm run test:cadena`: tres canciones encadenadas solas, que
es como se usa el mezclador de verdad. De ahí salieron dos de los errores de
arriba —una sola transición, por muy medida que esté, no los enseña—. Con ella,
`npm run verify` comprueba lint, 233 pruebas, el arranque real, arrastrar y
soltar, una transición con lupa y una sesión entera.

Comprobado también sobre la aplicación real: los tres estilos de entrada
—cambio de graves, fundido largo y corte— sin un silencio ni una excepción, y
mezcla tras mezcla sin que la música se pare.

## 3.1.0 — 2026-08-23

La versión que hace que el mezclador **suene y se vea cuadrado**. La 3.0.0
tenía la coreografía bien y la rejilla mal: sabía qué hacer, pero no sabía
exactamente cuándo.

### Cuadrar de verdad

- **La rejilla ya no se estima, se ajusta.** Antes se cogía el tempo del
  detector —con la resolución de su autocorrelación— y se buscaba la fase. Un
  tempo con medio punto de error acumula un segundo de desfase en tres minutos:
  la mezcla empezaba bien y terminaba hecha un desastre. Ahora se busca el par
  (tempo, fase) que hace que **todos** los golpes de la canción caigan sobre la
  rejilla. Sobre una caja de ritmos fabricada a 128,00, antes salía 128,7 y un
  desfase de 70 ms; ahora salen 128,00 y 1 ms.
- **La envolvente ya no adelanta los golpes.** Se medía la energía con una FFT
  por marco, que además de costar diez veces más situaba cada golpe media
  ventana antes de que ocurriera. Ahora es un filtro aplicado de ida y de
  vuelta —fase cero— con marcos de 5,8 ms en vez de 23.
- **Y el tempo se guarda con decimales.** La biblioteca lo redondeaba a una
  décima al guardarlo, que es tirar por el desagüe justo la precisión que hace
  falta: una décima a 128 son cuarenta milisegundos al final de una canción.
- **Un empujón al entrar.** Colocar el plato en su sitio no basta: entre pedirle
  una posición y que empiece a sonar se le van unos milisegundos. Ahora, medio
  segundo después de arrancar, se mide el desfase real entre las dos rejillas y
  se corrige acelerando un 2 % lo justo para recuperarlo, como quien empuja el
  plato con el dedo. Medido en la prueba de extremo a extremo: **2 ms de
  desfase mediano** durante toda la transición, donde antes había 24.

### Como lo haría un pinchadiscos

- **Se pincha en frase, no solo en compás.** El análisis busca qué compás abre
  la frase —el que cambia de nivel— y, cuando las dos canciones la tienen clara
  y la transición mide frases enteras, los unos de las dos coinciden en el
  primer compás de la frase.
- **La que entra empieza por donde suena, no por el segundo cero.** Casi ningún
  archivo empieza a sonar en el cero: hay silencio o una entrada que se abre.
  Meterlo en la mezcla es de las cosas que más cantan. Ahora se detecta por
  dónde entra de verdad y se pincha desde ahí.
- **El cambio de graves cae en un inicio de compás**, no a mitad de nada. Y si
  la canción que sale se acaba antes, la transición se acorta **por compases
  enteros**: más corta, pero cuadrada.
- **Sitio para la voz.** La que entra lo hace con los graves fuera y también con
  un pellizco en los medios, que es donde se pelean las voces; se le devuelven
  en el mismo compás del cambio.

### Analizar en lote

- **Botón «Analizar» en la biblioteca**, con el número de canciones que le
  faltan. Analiza lo seleccionado o todo lo que se esté viendo.
- **Se salta lo que ya está hecho** y pregunta antes de rehacerlo: volver a
  analizar mil canciones para arreglar dos es tiempo tirado.
- **Con progreso y con botón de parar**: dice por qué canción va y se corta en
  cuanto termine esa. Una canción rota se cuenta y se sigue, no tumba el lote.
- **Desde el mezclador**, además: analizar las dos que van a sonar o la cola
  entera de una vez.

### Corregido

- **Cortar una mezcla dejaba la canción sin graves para siempre.** A mitad de
  transición el plato que entra tiene los graves quitados; al pasar de canción
  o pausar, nadie se los devolvía. Es el error más gordo de la 3.0.0 y no había
  manera de saber por qué sonaba mal.
- **La pantalla se quedaba mezclando** después de darle a siguiente: el
  reproductor avisaba de que la transición había terminado y nadie escuchaba
  ese aviso.
- **Pausar a mitad de mezcla** dejaba un plato parado y otro sonando. Ahora
  pausar corta la transición y deja una sola canción, que es lo que se espera.
- **La mezcla automática se quedaba en un compás.** El aviso de «se acerca el
  final» se calculaba con la duración ya recortada por el final de la canción,
  así que cada repaso la acortaba un poco más. Ahora se calcula con la duración
  pedida.
- **Un solo interruptor de tempo.** El bpm que se enseña abajo es el que suena.

### Al actualizar

- **Las rejillas de la 3.0.0 se marcan como pendientes.** Salían de un tempo
  estimado y de una envolvente que adelantaba los golpes: valen para saber el
  tempo aproximado, no para pinchar. La aplicación las cuenta como sin analizar
  y ofrece rehacerlas, en vez de mezclar con datos que no cuadran.
- **El ajuste de tempo de una mezcla ya no se queda puesto.** Al elegir una
  canción a mano se vuelve a su velocidad; el tempo que hayas puesto tú en el
  panel de sonido se respeta.

### Por dentro

- 226 pruebas (`npm test`), 29 de ellas sobre la rejilla, con una que fabrica
  cuatro minutos de música y comprueba que el último golpe sigue cayendo donde
  debe.
- `npm run test:mezcla` mide ahora también el análisis en lote, el desfase entre
  las dos rejillas durante toda la transición y qué pasa al cortar una mezcla a
  la mitad: 21 comprobaciones sobre la aplicación de verdad.

## 3.0.0 — 2026-08-23

La versión del **mezclador**: deja de ser una casilla escondida en un panel y
pasa a ser una parte de la aplicación con pantalla, criterio y nombre propios.

### El mezclador, con entidad propia

- **Pantalla propia**, en la barra lateral. Enseña las dos canciones como dos
  platos con su tempo, su tonalidad y su rejilla, y dice en una línea qué va a
  hacer —«8 compases · Cambio de graves · ajuste de tempo +1,6 %»— antes de
  hacerlo. Nada de números mágicos.
- **Espera al compás.** La transición ya no empieza al pulsar el botón, sino en
  el siguiente inicio de compás de la que está sonando; y la que entra arranca
  en *su* inicio de compás. Es la diferencia entre dos canciones sonando a la
  vez y una mezcla: en las pruebas los compases de las dos se mantienen a menos
  de un 2 % de distancia durante quince segundos.
- **Detecta por dónde entra el bombo.** El análisis busca los golpes en la banda
  grave (25–150 Hz), coloca la rejilla de compases y decide cuál es el tiempo
  fuerte. Cuando el bombo no se distingue, lo dice y usa el pulso general.
- **Cambio de graves, como en una cabina.** La que entra lo hace con los graves
  fuera (−26 dB), sube de volumen durante la primera mitad y, en un tiempo seco
  a mitad de transición, se intercambian los graves de las dos. La que sale se
  va por arriba en la segunda mitad. También hay *Fundido largo* y *Corte en el
  compás*, de cuatro a treinta y dos compases.
- **Se ve lo que está pasando.** Durante la transición, la pantalla enseña el
  volumen y los graves reales de cada plato leídos del grafo de audio, con la
  marca de dónde cae el cambio. No es una animación decorativa.
- **Avisa en vez de disimular.** Si falta el análisis de una canción, si los
  tempos están a más de un 12 % o si las tonalidades chocan, lo dice antes de
  sonar y ofrece analizar ahí mismo.
- **Un solo interruptor de mezcla automática.** Antes había dos —uno en el panel
  de sonido que no hacía nada— y ninguno de los dos mandaba del todo.

### Estirado de tiempo

- **Mando de tempo en el panel de sonido**, de −20 % a +20 %, con la casilla
  *Mantener el tono*: con ella, la canción cambia de velocidad sin cambiar de
  tonalidad (estirado de tiempo real del motor, medido: un tono de 323 Hz sigue
  en 323 Hz a ×1,2); sin ella, sube el tono como un vinilo acelerado.
- **El bpm que se enseña es el que suena.** Con el tempo ajustado, la línea de
  información de abajo pasa a decir el tempo real y cuánto se ha estirado
  («130 bpm · +1,6 %»), en vez del número del archivo.
- El mezclador usa el mismo mando: cuando una mezcla ajusta el tempo, ese pasa a
  ser el tempo del reproductor, y encadenar una tercera canción parte de ahí en
  vez de volver al del archivo.

### Corregido

- **El ajuste de tempo no llegaba al plato.** El plan decía «+1,6 %» y la
  canción entraba a su velocidad, desincronizada: asignar `src` reinicia el
  elemento y con él `playbackRate`, y la velocidad se ponía antes. Ahora se pone
  después y se repite al cargar los metadatos.
- **Los dos platos se quedaban vacíos** en la pantalla del mezclador justo
  cuando empezaba a sonar la mezcla, porque la cola ya había avanzado.

### Por dentro

- `shared/beats.js` (rejilla de compases y bombo) y `shared/mezcla.js` (el plan
  de una transición, como lista de eventos con su instante y su rampa) son
  funciones puras: 36 pruebas nuevas comprueban una mezcla de discoteca sin
  encender un altavoz.
- `renderer/mezclador.js` es la unidad: decide, recuerda y avisa a quien mire.
  El reproductor solo ejecuta el plan sobre el reloj del audio.
- `npm run test:mezcla`: prueba nueva de extremo a extremo que fabrica dos
  canciones con bombo a 128 y 126, las analiza con el analizador de verdad y
  mide la transición sobre el grafo de audio. Falla si se vuelve a colar el
  error del tempo: es la única manera de verlo.
- 193 pruebas en total (`npm run verify` encadena lint, pruebas, arranque real,
  arrastre y mezcla).

## 2.0.0 — 2026-08-23

La versión en la que Pletina deja de ser solo un reproductor: ahora también
puede tocar tus archivos —si se lo pides— y escuchar lo que suena.

### Tus archivos, cuando tú quieras

- **Escribir las etiquetas dentro del archivo.** Hasta ahora la corrección solo
  vivía en Pletina y otro reproductor seguía viendo el nombre viejo. Hay una
  casilla en el diálogo de corrección y una opción en el menú de cada canción.
  Funciona en **MP3 y WAV**; los demás formatos lo dicen por su nombre en vez de
  fallar en silencio. Antes de tocar nada se guarda una copia `.pletina-bak` al
  lado del original, se escribe en un temporal y se renombra encima, para que un
  corte a mitad no deje el archivo destrozado. Sin marcar la casilla, la promesa
  de siempre sigue en pie: tu música no se toca.
- **Carátulas.** Se puede poner una imagen a una canción o a una selección
  entera, y quitarla. Como con las etiquetas: solo vive en Pletina, salvo que
  pidas escribirla —en MP3 va dentro del archivo; el WAV no tiene dónde llevarla
  y se avisa en vez de fingir que sí—.

### Cómo se ordenan las cosas

- **Los artículos dejan de estorbar.** «Los Planetas» va por la P y «The
  Beatles» por la B, como en cualquier estantería de discos. Se puede desactivar
  desde *Ver*.
- **Lo que no se sabe va al final**, se ordene ascendente o descendente: un
  disco sin año no es del año cero y una canción sin analizar no va a cero
  pulsaciones.
- **Las rejillas de álbumes y artistas se pueden ordenar** por artista, título,
  año o número de canciones.
- **Reordenar una lista entera por un criterio** vuelve a estar donde estaba en
  la maqueta original y se había perdido por el camino.

### Cherry picks

- **Ecualizador de diez bandas** con seis ajustes previos y preamplificación.
- **Visualizador**: espectro y onda en su propia franja, que se apaga sola
  cuando no suena nada y respeta a quien pide menos movimiento en su sistema.
- **Fundido entre canciones** de hasta doce segundos, con curvas de igual
  potencia: sin el bajón de volumen que deja un cruce lineal.
- **Mezcla automática**: la canción que entra ajusta su tempo al de la que sale,
  siempre que el cambio sea discreto —por encima de un 8 % se nota y no se hace—.
- **Tempo y tonalidad**: análisis del audio bajo petición, en una canción o en
  una selección. Si el archivo ya trae el dato en sus etiquetas, se aprovecha.
  Se puede ordenar la biblioteca por cualquiera de los dos.

### Por dentro

- El audio pasa ahora por Web Audio, con dos platos para poder encadenar. Eso
  destapó dos condiciones que no se ven venir: un elemento que va a entrar en el
  grafo necesita permiso de origen cruzado —y el esquema propio hay que
  declararlo con `corsEnabled`, no basta la cabecera— o el grafo suena a
  silencio sin dar un solo error.
- El tempo y la tonalidad se calculan con matemática pura, fuera del
  renderizador, para poder probarla con señales fabricadas: un metrónomo de 120
  tiene que dar 120 y un acorde de Do mayor tiene que dar Do mayor. Las pruebas
  cazaron tres errores antes de que llegaran a la interfaz —el chroma salía
  rotado tres semitonos, el tempo perdía precisión por resolución y la relativa
  menor estaba invertida—.
- De 106 a 156 pruebas.

## 1.1.0 — 2026-08-23

### Arreglado

- **Arrastrar y soltar no importaba nada.** Un `FileList` no sobrevive al puente
  de contextos de Electron: cruza como un proxy sin iterador, así que el preload
  recibía una lista vacía y `getPathForFile` no tenía nada que resolver. La
  aplicación se quedaba callada —ni error, ni aviso— y parecía que soltar
  archivos simplemente no hacía nada. Ahora la lista se esparce en el
  renderizador antes de cruzar, el preload acepta las dos formas y avisa si le
  llega vacía, y soltar algo ilegible lo dice en pantalla.
- **El `drop` dependía de que el sistema rellenara `dataTransfer.types`.** Si esa
  lista venía vacía no se llamaba a `preventDefault` en `dragover` y el navegador
  se quedaba el arrastre: el evento `drop` no llegaba nunca. Ya no se condiciona
  la función a esa lista, solo el cartel de «suelta aquí».
- Restaurar las etiquetas de un archivo que ya no se puede leer conservaba el
  recuento pero borraba la corrección, dejando el nombre inventado y sin manera
  de recuperar el bueno. Ahora se conserva y se avisa.
- Marcar como favoritas cien canciones eran cien viajes al proceso principal;
  ahora es uno.
- «Nº de pista» se leía como «No de pista» en el formulario. Ahora pone «Pista».

### Añadido

- **Corregir la información de una canción.** Título, artista, artista del
  álbum, álbum, género, año, pista y disco. Los archivos del disco no se tocan
  —esa es la promesa de Pletina—: la corrección vive en la biblioteca, gana a lo
  que diga la etiqueta y sobrevive a los reanálisis. Se puede deshacer con
  *Volver a las etiquetas del archivo*.
- **Corrección en lote.** Con varias canciones seleccionadas se editan solo los
  campos que comparten, y lo que se deja en blanco no se toca: un álbum entero
  mal etiquetado se arregla de una vez sin machacar los títulos.
- **Temporizador de apagado** (menú *Reproducción*): a los 15, 30, 45 o 60
  minutos, o al terminar la canción que suena. Mientras corre, la cuenta atrás
  se ve en la barra inferior y se cancela pulsándola.
- **Guardar la cola como lista**, desde la cabecera del panel de cola.

### Por dentro

- `npm run test:arrastre` levanta la aplicación de verdad, suelta un archivo real
  sobre la ventana y comprueba que acaba en la biblioteca. Existe porque el error
  de arriba vivía justo en la costura entre renderizador y preload, donde ni las
  pruebas unitarias ni el arranque de humo podían verlo.
- Nuevas pruebas de contrato entre procesos: cada orden del menú tiene quien la
  atienda, cada canal del preload existe en el proceso principal y cada evento
  que se envía tiene una suscripción. Una errata en esos nombres no rompe nada
  visible —el menú se abre, se pulsa y no pasa nada—, y ahora se caza en CI.
- De 93 a 106 pruebas.

## 1.0.0 — 2026-08-23

Primera versión: la maqueta web convertida en aplicación de escritorio.

- Biblioteca por rutas, sin copiar la música a ningún sitio.
- Esquemas propios `pletina://` y `pletina-media://`, este último con soporte de
  `Range` para poder buscar dentro de una canción.
- Etiquetas con music-metadata, carátulas cacheadas por hash y reescaladas.
- Análisis incremental, ausencias marcadas y discos desconectados respetados.
- Menú nativo, teclas de medios, «abrir con», papelera y tema del sistema.
- Ventana integrada: barra de título propia en Windows y semáforos embutidos en
  macOS.
- Álbumes, artistas, favoritos, escuchado hace poco, listas, cola, selección
  múltiple y M3U de ida y vuelta.
