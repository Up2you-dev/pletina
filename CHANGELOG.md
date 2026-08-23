# Registro de cambios

Las versiones siguen [SemVer](https://semver.org/lang/es/). Cada una se
construye desde la pestaña *Actions* del repositorio; una etiqueta `v1.2.3`
además publica los instaladores sueltos en la página de versiones.

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
