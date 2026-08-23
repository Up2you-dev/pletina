# Pletina

Reproductor de música local para escritorio. Tu biblioteca vive en tu disco, con
tus carpetas tal cual; Pletina la lee, la ordena y la reproduce. Sin nube, sin
cuentas, sin conexión: la aplicación no abre un solo socket a internet.

Nació como una maqueta HTML de una sola página. Esto es la misma idea convertida
en programa: **Electron 43, ESM en todos lados, sin `nodeIntegration` y con dos
esquemas propios** para servir la interfaz y el audio.

## Cómo se ejecuta

**Con un instalador**, que es como se usa a diario. No hace falta tener nada de
programación instalado: en la pestaña **Actions › Instaladores › Run workflow**
de este repositorio se construyen los tres sistemas a la vez, y al terminar
cuelgan de esa misma ejecución, en *Artifacts*:

| Artefacto | Qué trae |
|---|---|
| **`pletina-windows-instalador`** | `Pletina Setup 1.0.0.exe`, el instalador de toda la vida (x64 y arm64) |
| `pletina-windows-sin-instalar` | `Pletina 1.0.0.exe` portable y el `.zip` que se descomprime y se ejecuta |
| `pletina-macos` | `Pletina-1.0.0-arm64.dmg` — abrir y arrastrar a Aplicaciones |
| `pletina-linux` | `Pletina-1.0.0.AppImage` (`chmod +x` y doble clic) y el `.deb` |

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
npm run verify       # lint + 93 pruebas + arranque real con captura
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
└─ shared/      lógica pura compartida y probada (cola, orden, formato, Range)
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

**Estado regenerable y estado del usuario, separados.** Las etiquetas se pueden
volver a leer del disco cuando haga falta; los favoritos, las escuchas y las
listas no. Por eso un reanálisis conserva siempre lo segundo, aunque el archivo
haya cambiado.

**Escritura atómica.** `biblioteca.json` y `ajustes.json` se escriben en un
temporal y se renombran, con las escrituras agrupadas. Un corte de luz no deja un
JSON a medias, y un JSON ilegible se aparta como `.corrupto` en vez de perderse.

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

- `npm test` — 93 pruebas sobre la lógica pura (cola, orden y búsqueda, formato,
  `Range`) y sobre el almacén y la biblioteca contra archivos de verdad en
  carpetas temporales: análisis incremental, ausencias, discos desconectados,
  listas y M3U de ida y vuelta.
- `npm run smoke` — levanta la aplicación de verdad, comprueba que la interfaz se
  pinta sin un solo error de consola y guarda una captura. En Linux sin
  escritorio usa `xvfb-run` automáticamente.

## Límites conocidos

- Sin firma ni notarización (arriba).
- No hay reproducción sin cortes (*gapless*) de verdad: se precarga la siguiente
  canción para acortar el salto, pero entre pistas hay un silencio mínimo.
- Las carátulas sueltas se buscan por nombre (`cover.jpg`, `folder.jpg`…), no por
  contenido.
- La vigilancia de carpetas usa `fs.watch` recursivo; en sistemas de archivos en
  red o con los límites de inotify agotados se desactiva sola y hay que reanalizar
  a mano (`Cmd/Ctrl+Alt+R`).
