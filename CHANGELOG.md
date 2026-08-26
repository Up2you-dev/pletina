# Registro de cambios

Las versiones siguen [SemVer](https://semver.org/lang/es/). Cada una se
construye desde la pestaña *Actions* del repositorio; una etiqueta `v1.2.3`
además publica los instaladores sueltos en la página de versiones.

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

También: la nota de la pantalla del mezclador decía que se pincha en compás y
por el principio del archivo, que es lo que hacía la versión anterior.

Comprobado sobre la aplicación real, no solo en pruebas unitarias: los tres
estilos de entrada —cambio de graves, fundido largo y corte— sin un silencio ni
una excepción, y encadenar mezcla tras mezcla sin que la música se pare. 227
pruebas.

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

- 227 pruebas (`npm test`), 29 de ellas sobre la rejilla, con una que fabrica
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
