# Pletina

Reproductor de música local para escritorio. Tu biblioteca vive en tu disco, con
tus carpetas tal cual; Pletina la lee, la ordena y la reproduce. Sin nube, sin
cuentas, sin conexión: la aplicación no abre un solo socket a internet.

Nació como una maqueta HTML de una sola página. Esto es la misma idea convertida
en programa: **Electron 43, ESM en todos lados, sin `nodeIntegration` y con dos
esquemas propios** para servir la interfaz y el audio.

## Cómo se ejecuta

**Descárgalo de [la página de versiones](https://github.com/Up2you-dev/pletina/releases)**,
que es donde vive lo publicado. No hace falta tener nada de programación
instalado ni identificarse: cada archivo se baja de uno en uno.

| Archivo | Qué es |
|---|---|
| `Pletina Setup X.Y.Z.exe` | Instalador de Windows. Doble clic y listo |
| `Pletina X.Y.Z.exe` | Portable: no instala nada, pesa la mitad |
| `Pletina-X.Y.Z-win.zip` | La carpeta suelta, para descomprimir donde quieras |

Para **construir una versión nueva**: pestaña *Actions › Instaladores › Run
workflow*, se elige el sistema y, si se deja marcada la casilla de publicar, los
archivos acaban solos en la página de versiones con las notas del registro de
cambios. Una etiqueta `vX.Y.Z` hace lo mismo con los tres sistemas a la vez.
Los artefactos de la ejecución siguen ahí para lo que no se publica:

| Artefacto | Qué trae |
|---|---|
| **`pletina-windows-instalador`** | `Pletina Setup X.Y.Z.exe`, el instalador de toda la vida (x64 y arm64) |
| `pletina-windows-sin-instalar` | `Pletina X.Y.Z.exe` portable y el `.zip` que se descomprime y se ejecuta |
| `pletina-macos` | `Pletina-X.Y.Z-arm64.dmg` — abrir y arrastrar a Aplicaciones |
| `pletina-linux` | `Pletina-X.Y.Z.AppImage` (`chmod +x` y doble clic) y el `.deb` |

Al lanzarlo a mano se elige un solo sistema —Windows por defecto— y se enciende
una sola máquina. Publicar una etiqueta `v1.2.3` construye los tres y además
cuelga los archivos sueltos en la página de versiones, que es de donde se
descargan de uno en uno.

Al ser paquetes **sin firmar**, la primera vez Windows enseña la pantalla azul de
SmartScreen: *Más información* › *Ejecutar de todas formas*. Solo la primera vez,
y solo con el instalador que te has construido tú. El porqué está más abajo, en
«Empaquetado».

**Desde el código**, para trastear, desarrollar o fabricarte el instalador en tu
propio PC. Solo hace falta [Node 20 o superior](https://nodejs.org); no hay
módulos nativos, así que `npm install` no compila nada ni necesita Visual Studio:

```powershell
git clone https://github.com/Up2you-dev/pletina.git
cd pletina
npm install          # incluye la descarga del binario de Electron (~120 MB)
npm start            # abre la aplicación
npm run dist:win     # y esto te deja el instalador en release\
```

Y para lo demás:

```bash
npm run verify       # lint + 314 pruebas + arranque real, arrastre, mezcla, cadena y rejilla
npm run dist:mac     # .dmg (arm64 + x64)  · hay que ejecutarlo EN un Mac
npm run dist:linux   # AppImage + .deb
```

Los tres objetivos de Windows (`nsis`, `portable`, `zip`) salen de un mismo
`npm run dist:win`. Desde Linux o macOS solo sale el `zip`: los dos primeros
pasan por NSIS, que necesita Windows o wine.

La primera vez que la abras estará vacía: pulsa **Añadir música**, elige la
carpeta donde tengas tus discos y espera a que termine de leer las etiquetas.
No se copia nada; a partir de ahí, cada arranque comprueba solo lo que haya
cambiado.

## Qué cambia respecto a la versión web

| | Maqueta HTML | Pletina |
|---|---|---|
| Dónde vive la música | copiada dentro de IndexedDB del navegador | **se queda en tu disco**; se guardan rutas y etiquetas |
| Límite de tamaño | la cuota del navegador (y se pierde al limpiar datos) | el que tenga tu disco |
| Etiquetas | lector de ID3v2 propio, solo MP3 | `music-metadata`: MP3, FLAC, M4A, OGG, Opus, WAV, AIFF, WMA… |
| Carátulas | blob en memoria por canción | caché en disco por *hash*, reescalada y compartida entre las canciones del mismo disco |
| Búsqueda dentro de la canción | por blob completo en memoria | peticiones `Range` reales sobre el archivo |
| Carpetas | no existían | se vigilan y se reanalizan solas al cambiar |
| Sistema | ninguna integración | menú nativo, teclas de medios, «abrir con», papelera, tema del sistema |

## Cómo está montado

```
src/
├─ main/        proceso principal: ventana, menú, protocolos, biblioteca, almacén
├─ preload/     el único puente, por contextBridge (preload.mjs)
├─ renderer/    la interfaz: sin framework, módulos ES servidos por pletina://
└─ shared/      lógica pura compartida y probada (cola, orden, formato, Range,
                tempo y tonalidad, rejilla de compases, plan de mezcla,
                ondas de tres bandas y geometría del visor)
```

**Dos esquemas propios.** `pletina://` sirve la interfaz —al no ser `file://`, la
ventana tiene un origen de verdad, los módulos ES cargan y la CSP se puede
apretar—. `pletina-media://` sirve audio y carátulas, y solo de archivos que
estén en la biblioteca: el renderizador nunca ve una ruta absoluta ni puede pedir
otra cosa. Ese manejador implementa `Range` (206 con `Content-Range`), que es lo
que hace que arrastrar la barra de posición funcione en un FLAC de 300 MB.

**Ventana integrada.** En Windows la barra de título la dibuja la propia
aplicación y el sistema solo superpone sus tres botones, con los colores del tema
puestos desde el proceso principal; el menú nativo, que ahí deja de verse, se
abre con el botón de la esquina. En macOS los semáforos van embutidos en la misma
barra. Es la diferencia entre una aplicación y una web enmarcada.

**El renderizador no tiene Node.** `contextIsolation: true`, `nodeIntegration:
false`, navegación externa bloqueada y CSP sin `script-src` remoto. Todo lo que
la interfaz puede hacer está enumerado en `src/preload/preload.mjs`.

**Un análisis incremental.** Solo se releen las etiquetas de los archivos cuyo
tamaño o fecha han cambiado; la segunda pasada sobre una biblioteca grande es
casi instantánea. Lo que desaparece se marca como ausente, no se borra —y si el
disco entero no responde, no se marca nada: se avisa de que la carpeta no está.

**Las correcciones no tocan tus archivos, salvo que lo pidas.** Si una canción
viene con el título mal escrito se puede corregir —una a una o un álbum entero de
golpe— y por defecto la corrección se guarda en la biblioteca, se aplica encima
de lo que diga el archivo y sobrevive a los reanálisis. Marcando la casilla
*Escribir también dentro del archivo*, baja al MP3 o al WAV: antes se deja una
copia `.pletina-bak` al lado, se escribe en un temporal y se renombra encima, así
que un corte a mitad no puede destrozar la canción.

**El sonido pasa por Web Audio.** De ahí salen el ecualizador de diez bandas, el
visualizador, el estirado de tiempo y el mezclador, que necesita dos platos
sonando a la vez. El tempo y la tonalidad se calculan aparte, en matemática pura
y probada con señales fabricadas, y solo cuando se piden: decodificar el audio de
una biblioteca entera costaría horas para un dato que casi nadie mira.

**Estado regenerable y estado del usuario, separados.** Las etiquetas se pueden
volver a leer del disco cuando haga falta; los favoritos, las escuchas y las
listas no. Por eso un reanálisis conserva siempre lo segundo, aunque el archivo
haya cambiado.

**Escritura atómica.** `biblioteca.json` y `ajustes.json` se escriben en un
temporal y se renombran, con las escrituras agrupadas. Un corte de luz no deja un
JSON a medias, y un JSON ilegible se aparta como `.corrupto` en vez de perderse.

## La cabina

El mezclador tiene pantalla propia, estado propio y su propio criterio: no es un
interruptor del reproductor, es una unidad que le toma prestados los dos platos.
Y se parece a una cabina porque hace lo que hace una cabina.

**Dos platos, uno encima de otro.** Arriba, lo que suena. Abajo, lo que
preparas. Cada uno con dos vistas de su onda: la general —la canción entera,
para ver la estructura y saltar por ella— y la ampliada, con la cabeza en el
centro y la rejilla de compases dibujada encima. Las dos vistas ampliadas
comparten el eje de tiempo, así que **cuando las dos canciones van cuadradas sus
líneas de compás caen a la misma altura**. Eso es lo que se mira al mezclar: no
el número, el dibujo. El número también está —el desfase entre las dos rejillas,
en milisegundos—, pero es la comprobación, no la herramienta.

**Ondas de tres bandas.** Graves en azul, medios en ámbar, agudos en gris. No es
decoración: en una silueta gris no se ve dónde entra el bombo ni dónde se va la
voz, y en tres colores se ve de un vistazo. Cuando una canción entra sin graves,
su banda grave se pinta a media luz: lo que se ve es lo que se oye.

**El plato B lo cargas tú.** Desde las sugerencias, desde el menú de cualquier
canción o desde la cola. Se queda esperando, colocado por donde la canción
empieza a sonar de verdad —casi ningún archivo empieza en el segundo cero—, se
puede preescuchar, mover arrastrando y quitar. La cola sigue estando, pero deja
de mandar: eso es lo que separa una cabina de una lista de reproducción.

**Arrastrar una onda es empujar el plato.** En el que suena se traduce en un
empujón —acelerar o frenar un pelo durante un momento— porque saltar sonaría a
corte; en el que preparas, que está parado, se mueve y ya. Con `,` y `.` se hace
lo mismo a golpe de tecla, y con `M` se lanza la mezcla.

**Y dos herramientas de precisión más.** *Compás adelante* y *compás atrás*
mueven el plato B un compás exacto, no «un poco». Y *el uno está aquí* corrige
la rejilla: el detector acierta casi siempre con el pulso y falla más con el
uno —hay canciones cuyo primer golpe fuerte no es el que parece—, y con el uno
mal la mezcla entra a contratiempo por muy afinado que esté el tempo. Se coloca
el plato donde de verdad empieza el compás, se pulsa, y la rejilla se queda
corregida para siempre sin volver a analizar nada.

**Qué pinchar después.** Un abanico de la biblioteca ordenado como lo pensaría
un pinchadiscos: primero lo que encaja de tonalidad, luego lo que menos hay que
estirar, y fuera lo que no se puede cuadrar sin que se note.

Qué hace en una transición:

1. **Espera a la frase.** El pinchazo no cae al pulsar el botón, sino en el
   siguiente inicio de frase de la que está sonando —o de compás, si la frase no
   está clara—; y la que entra empieza en el suyo. Es lo que hace que los dos
   bombos caigan juntos en vez de pisarse.
2. **Iguala el tempo** de la que entra al de la que sale, siempre que la
   distancia sea inferior al 12 % —medio tempo y doble tempo cuentan como el
   mismo pulso—. Con el estirado de tiempo activado, la canción cambia de
   velocidad sin cambiar de tonalidad.
3. **Empuja el plato.** Medio segundo después de arrancar mide el desfase real
   entre las dos rejillas y lo corrige acelerando un 2 % lo justo para
   recuperarlo: entre pedirle una posición a un archivo y que suene se van
   milisegundos, y veinte milisegundos ya se oyen. Medido en la prueba de
   extremo a extremo: 2 ms de desfase mediano durante toda la transición.
4. **Cambia los graves.** La que entra lo hace con los graves fuera (−26 dB) y
   con un pellizco en los medios, que es donde se pelean las voces: dos bombos a
   la vez suenan a barro. Sube de volumen durante la primera mitad y, en un
   inicio de compás a mitad de transición, se intercambian los graves. La que
   sale se va por arriba en la segunda mitad.
5. **Avisa en vez de disimular.** Si a una canción le falta el análisis, si los
   tempos están demasiado lejos o si las tonalidades chocan, lo dice antes de
   sonar y ofrece analizar ahí mismo.

**La rejilla es lo que hace que suene cuadrado.** No se estima: se ajusta. Del
detector de tempo sale un número aproximado, y a partir de ahí se busca el par
(tempo, fase) que hace que *todos* los golpes de la canción caigan encima de la
rejilla. La diferencia importa más de lo que parece: medio punto de error en el
tempo son casi dos segundos de desfase al final de una canción de seis minutos,
y una mezcla que empieza cuadrada y acaba de cualquier manera. La energía del
bombo se mide con un filtro aplicado de ida y de vuelta, que no tiene desfase,
en marcos de seis milisegundos.

**Y en su octava.** Un detector de tempo se equivoca del doble o de la mitad con
mucha facilidad —una balada de bombo flojo sale a 144 en vez de a 72; un garage
con el bombo al uno y al tres, a 65 en vez de a 130— y con la octava cambiada da
igual lo fino que se afine después: la mezcla no cuadra jamás. Así que se prueban
el doble, la mitad y los tercios de por medio, y gana la que más **contraste**
saca: cuánta más energía hay en los golpes que entre golpe y golpe. Es la medida
que las distingue, porque una rejilla a la mitad cae solo sobre golpes fuertes
—buena media— pero el punto medio entre sus golpes cae encima de los que se ha
saltado, y ahí se delata. La octava se decide con el grupo entero y la fase con
el bombo: cada cosa con lo que sabe.

**La confianza dice la verdad.** No es «cuánta energía he encontrado» sino lo que
destacan los golpes multiplicado por lo bien que un solo tempo explica la canción
de punta a punta. Con eso, una charla o un ambiente se quedan **sin** rejilla
—una rejilla inventada cuadra el pinchazo con la nada— y una grabación tocada a
mano se analiza pero avisa: «el tempo se mueve · cuadra a ojo». Y cuando la
máquina y tú no estéis de acuerdo, **×2 y ÷2** cambian la cuenta en un clic sin
mover un solo golpe de sitio: hay ritmos que se pueden contar de las dos maneras
y las dos son ciertas.

**Cómo está partido.** El plan de una mezcla es una función pura —qué pasa y
cuándo, como una lista de eventos con su instante, su parámetro y su rampa— en
`shared/mezcla.js`; el análisis del bombo y la rejilla de compases, en
`shared/beats.js`; las cuentas del visor, en `shared/onda-vista.js`; la unidad
que decide y recuerda, en `renderer/mezclador.js`; el dibujo, en
`renderer/ui/onda.js`; y la traducción a automatización del grafo de audio, en
`renderer/player.js`. Por eso se puede probar una transición de discoteca sin
altavoces: se mira el plan y se comprueba que los graves se cambian en el compás
correcto. Todo se programa de una vez sobre el reloj del audio, nunca con
temporizadores de JavaScript: un `setTimeout` llega tarde, y en una mezcla eso
son dos bombos pisándose.

**Por qué el visor es propio.** Se miró lo que hay hecho: `wavesurfer.js`
(BSD-3) es el estándar para pintar ondas en la web, pero está construido
alrededor de su propio reproductor y de su propia línea de tiempo, y aquí hacen
falta dos platos sobre un eje compartido, estirados por el ajuste de tempo y
pintados con el reloj de audio de la aplicación; `peaks.js` es LGPL y arrastra
el mismo problema de modelo. Así que el visor son doscientas líneas de lienzo
propias —pero la técnica de dibujo no se ha inventado: tres formas rellenas
centradas, la grave detrás y la aguda delante, que es como lo hacen rekordbox y
Serato.

**Las ondas se guardan.** Se calculan al analizar —tres bandas, ciento cincuenta
marcos por segundo— y viven en su propia carpeta, un archivo por canción: ciento
treinta kilobytes para cinco minutos, que se dibujan sin decodificar nada. Es
regenerable: si se borra la carpeta, basta con volver a analizar.

## Datos

Todo vive en la carpeta de datos del sistema (`Ayuda › Abrir la carpeta de datos`):

- Windows: `%APPDATA%\Pletina`
- macOS: `~/Library/Application Support/Pletina`
- Linux: `~/.config/Pletina`

Con `biblioteca.json` (rutas y etiquetas), `ajustes.json` (volumen, vista, última
canción y su posición), `caratulas/` (portadas reescaladas) y `ondas/` (la forma
de onda de tres bandas de cada canción analizada). Borrar esa carpeta
deja la aplicación como recién instalada; **la música no se toca nunca**.

## Atajos

| | |
|---|---|
| Espacio | reproducir / pausa |
| N · P | siguiente · anterior |
| → ← | ±5 s |
| ↑ ↓ | volumen |
| S · R · Q · F | aleatorio · repetir · cola · favorita |
| G | ir a lo que está sonando |
| M | mezclar ahora |
| , · . | empujar el plato que suena |
| [ · ] | en la cabina, un compás atrás · adelante en el plato B |
| B | en la cabina, preescuchar el plato B |
| / o `Cmd/Ctrl+F` | buscar |
| `Cmd/Ctrl` + 1…6 | biblioteca, álbumes, artistas, favoritos, reciente, mezclador |
| `Cmd/Ctrl+E` | ecualizador y mezcla |
| `Cmd/Ctrl+U` · `Cmd/Ctrl+M` | cola · silenciar |
| Alt + → ← | ±10 s |
| Alt + ↑ ↓ | mover la canción dentro de una lista |
| Mayús · Cmd/Ctrl + clic | seleccionar varias |
| Supr | quitar lo seleccionado |

Los atajos con `Ctrl` los atiende la ventana además del menú: en Windows la
barra de menú no se ve y sus aceleradores dependen de que el sistema los
reparta. La ficha completa está en `Cmd/Ctrl + /`.

Las teclas de medios del teclado (⏯ ⏭ ⏮) funcionan aunque la ventana no esté en
primer plano. En macOS el sistema puede pedir permiso de accesibilidad para
cedérselas; si no lo concedes, todo lo demás sigue igual.

## Empaquetado

`electron-builder.yml` deja configurados los tres sistemas. Cada instalador se
construye **en su sistema**: un `.dmg` solo sale de un Mac. Por eso el flujo de
trabajo `instaladores.yml` los reparte en tres máquinas y deja los resultados
colgando de la ejecución.

Los paquetes salen **sin firmar**, que es una decisión, no un olvido: firmar
exige un certificado de Authenticode (entre 200 y 400 € al año, y los de
validación extendida piden token físico) o de Apple Developer (99 $/año). Sin
firma, Windows enseña SmartScreen la primera vez —«Más información › Ejecutar de
todas formas»— y macOS pide abrir con el botón derecho. Para repartirlo a gente
que no seas tú, hay que añadir `win.certificateFile` y su contraseña por
variable de entorno, y en macOS `mac.identity` más `notarize`.

Los iconos no son un binario opaco: se generan por código con `npm run icons`
(`build/make-icons.mjs` dibuja el cuadrado y las barras con distancias con signo
y los empaqueta en `.ico` y `.icns`).

## Pruebas

- `npm test` — 314 pruebas sobre la lógica pura (cola, orden y búsqueda,
  formato, `Range`), sobre el almacén y la biblioteca contra archivos de verdad
  en carpetas temporales —análisis incremental, ausencias, discos desconectados,
  correcciones de etiquetas, listas y M3U de ida y vuelta— y de contrato entre
  procesos: cada orden del menú tiene quien la atienda y cada canal del preload
  existe al otro lado.
- `npm run smoke` — levanta la aplicación de verdad, comprueba que la interfaz se
  pinta sin un solo error de consola y guarda una captura.
- `npm run test:arrastre` — suelta un archivo real sobre la ventana real y
  comprueba que acaba en la biblioteca. Existe porque el error que rompía
  arrastrar y soltar vivía en la costura entre el renderizador y el preload,
  donde ninguna de las otras dos podía verlo.
- `npm run test:cadena` — tres canciones seguidas encadenadas solas, que es como
  se usa el mezclador de verdad. Aquí salieron dos errores que una sola
  transición no enseña: la mezcla automática se quedaba en un compás y el tempo
  ajustado no se propagaba a la siguiente canción. Comprueba que las dos
  transiciones ocurren solas, que no hay un silencio en toda la cadena y que los
  compases siguen juntos en las dos.
- `npm run test:mezcla` — treinta comprobaciones sobre la aplicación de
  verdad. Fabrica dos canciones con bombo a 128 y 126 —una con cuatro segundos
  de silencio delante—, las analiza en lote desde la biblioteca y mide la
  transición sobre el grafo de audio: que el tempo se afina hasta la centésima,
  que el desfase de la rejilla cae encima del bombo, que el pinchazo espera al
  compás, que la que entra no arranca por el silencio, que va a la velocidad del
  plan sin cambiar de tono, que entra sin graves, y que los compases de las dos
  se mantienen a menos de un 0,6 % durante quince segundos. Y luego corta una
  mezcla a la mitad y comprueba que la canción se queda con sus graves. Y de la
  cabina: que el análisis deja la onda guardada, que los cuatro lienzos se
  pintan de verdad, que la sugerencia carga en el plato B por donde la canción
  empieza a sonar y que empujar el plato lo mueve. Existe por el mismo motivo
  que la anterior: los dos errores más gordos del mezclador —el tempo que no
  llegaba al plato y los graves que no volvían— no los puede ver ninguna prueba
  unitaria.
- `npm run test:rejilla` — las tres cosas que un usuario nota y ninguna prueba
  unitaria ve. Fabrica canciones difíciles a propósito —con el bombo solo en el
  uno y en el tres, que es donde un detector dice la mitad del tempo—, las
  analiza con el analizador de verdad y comprueba que el tempo sale en su
  octava, que los golpes de la rejilla caen encima del bombo con error de
  milisegundos, que el ×2 no mueve un golpe de sitio, que los cuatro lienzos
  tienen tinta de tres colores, que un plato vacío explica por qué lo está y que
  cada atajo de teclado llega a donde tiene que llegar —incluso con el foco en
  un deslizador, que era justo donde se perdían.

En Linux sin escritorio, las cinco últimas usan `xvfb-run` automáticamente.

## Límites conocidos

- Sin firma ni notarización (arriba).
- Escribir etiquetas solo funciona en MP3 y WAV. En FLAC, M4A y compañía la
  corrección se queda en Pletina, y la aplicación lo dice al intentarlo.
- El mezclador no iguala tempos que estén a más de un 12 % de distancia: por
  encima, el estirado se nota y prefiere avisar a disimular.
- El estirado de tiempo es el del motor del sistema (WSOLA). Con ajustes
  grandes —más de un 15 %— aparecen los artefactos típicos en las voces; para
  mezclar, donde se mueve un 2 o 3 %, es transparente.
- El análisis de tempo acierta bien con música de pulso marcado y falla más con
  música libre o en vivo; por eso guarda su nivel de confianza y no se inventa un
  número cuando no lo tiene claro. Y en los ritmos que se pueden contar de dos
  maneras —un drum & bass son 174 o son 87— elige la lectura más habitual, que a
  veces no es la tuya: para eso están el ×2 y el ÷2 de la cabina.
- La rejilla supone un tempo constante en toda la canción. Con música tocada a
  mano —o con un final que se va frenando— cuadra al principio y se separa al
  final; con música de caja de ritmos, clava.
- Analizar cuesta unos segundos por canción, casi todos en decodificar el audio.
  Una biblioteca grande se analiza en lote y en segundo plano, pero no es
  instantáneo. Sin analizar no hay onda que dibujar: la cabina enseña la canción
  en gris y ofrece analizarla.
- La preescucha del plato B suena por la misma salida que la música, porque hay
  una sola. Sirve para encontrar la entrada con la música bajita, no para
  preparar a escondidas: eso pide una tarjeta con dos salidas.
- No hay reproducción sin cortes (*gapless*) de verdad: se precarga la siguiente
  canción para acortar el salto, pero entre pistas hay un silencio mínimo.
- Las carátulas sueltas se buscan por nombre (`cover.jpg`, `folder.jpg`…), no por
  contenido.
- La vigilancia de carpetas usa `fs.watch` recursivo; en sistemas de archivos en
  red o con los límites de inotify agotados se desactiva sola y hay que reanalizar
  a mano (`Cmd/Ctrl+Alt+R`).
