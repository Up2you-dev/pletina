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
npm run verify       # lint + 193 pruebas + arranque real, arrastre y mezcla
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
                tempo y tonalidad, rejilla de compases, plan de mezcla)
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

## El mezclador

Tiene pantalla propia, estado propio y su propio criterio: no es un interruptor
del reproductor, es una unidad que le toma prestados los dos platos. Encadena
dos canciones **como lo haría un pinchadiscos**, y enseña exactamente lo que va
a hacer antes de hacerlo.

Qué hace en una transición:

1. **Espera al compás.** El pinchazo no cae al pulsar el botón, sino en el
   siguiente inicio de compás de la que está sonando; y la que entra empieza en
   *su* inicio de compás. Es lo que hace que los dos bombos caigan juntos en vez
   de pisarse.
2. **Iguala el tempo** de la que entra al de la que sale, siempre que la
   distancia sea inferior al 12 % —medio tempo y doble tempo cuentan como el
   mismo pulso—. Con el estirado de tiempo activado, la canción cambia de
   velocidad sin cambiar de tonalidad.
3. **Cambia los graves.** La que entra lo hace con los graves fuera (−26 dB):
   dos bombos a la vez suenan a barro. Sube de volumen durante la primera mitad
   y, en un tiempo seco a mitad de transición, se intercambian los graves. La
   que sale se va por arriba en la segunda mitad.
4. **Avisa en vez de disimular.** Si a una canción le falta el análisis, si los
   tempos están demasiado lejos o si las tonalidades chocan, lo dice antes de
   sonar y ofrece analizar ahí mismo.

Hay tres maneras de entrar: *Cambio de graves* (la de siempre), *Fundido largo*
(cruce de igual potencia) y *Corte en el compás* (seco, sin cruce), de cuatro a
treinta y dos compases. Con «mezclar sola» encendido, lo hace con cada canción
de la cola sin tocar nada.

**Cómo está partido.** El plan de una mezcla es una función pura —qué pasa y
cuándo, como una lista de eventos con su instante, su parámetro y su rampa— en
`shared/mezcla.js`; el análisis del bombo y la rejilla de compases, en
`shared/beats.js`; la unidad que decide y recuerda, en `renderer/mezclador.js`;
y la traducción a automatización del grafo de audio, en `renderer/player.js`.
Por eso se puede probar una transición de discoteca sin altavoces: se mira el
plan y se comprueba que los graves se cambian en el compás correcto. Todo se
programa de una vez sobre el reloj del audio, nunca con temporizadores de
JavaScript: un `setTimeout` llega tarde, y en una mezcla eso son dos bombos
pisándose.

## Datos

Todo vive en la carpeta de datos del sistema (`Ayuda › Abrir la carpeta de datos`):

- Windows: `%APPDATA%\Pletina`
- macOS: `~/Library/Application Support/Pletina`
- Linux: `~/.config/Pletina`

Con `biblioteca.json` (rutas y etiquetas), `ajustes.json` (volumen, vista, última
canción y su posición) y `caratulas/` (portadas reescaladas). Borrar esa carpeta
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
| / o `Cmd/Ctrl+F` | buscar |
| Alt + ↑ ↓ | mover la canción dentro de una lista |
| Mayús · Cmd/Ctrl + clic | seleccionar varias |
| Supr | quitar lo seleccionado |

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

- `npm test` — 193 pruebas sobre la lógica pura (cola, orden y búsqueda,
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
- `npm run test:mezcla` — fabrica dos canciones con bombo a 128 y 126, las
  analiza con el analizador de verdad y mide la transición sobre el grafo de
  audio: que el pinchazo espera al compás, que la que entra va a la velocidad
  del plan sin cambiar de tono, que entra sin graves y que los compases de las
  dos se mantienen juntos (menos de un 2 % de compás de desfase durante quince
  segundos). Existe por el mismo motivo que la anterior: el plan era correcto y
  el plato no lo aplicaba, porque asignar `src` reinicia `playbackRate`. Ninguna
  prueba unitaria puede ver eso.

En Linux sin escritorio, las dos últimas usan `xvfb-run` automáticamente.

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
  número cuando no lo tiene claro.
- No hay reproducción sin cortes (*gapless*) de verdad: se precarga la siguiente
  canción para acortar el salto, pero entre pistas hay un silencio mínimo.
- Las carátulas sueltas se buscan por nombre (`cover.jpg`, `folder.jpg`…), no por
  contenido.
- La vigilancia de carpetas usa `fs.watch` recursivo; en sistemas de archivos en
  red o con los límites de inotify agotados se desactiva sola y hay que reanalizar
  a mano (`Cmd/Ctrl+Alt+R`).
