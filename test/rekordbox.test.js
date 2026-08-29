import { describe, expect, it } from 'vitest';
import {
  cuesDeMarcas, emparejar, leerColeccion, rejillaDeTempos, rutaDeLocation,
} from '../src/shared/rekordbox.js';

const COLECCION = `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="rekordbox" Version="6.7.4" Company="AlphaTheta"/>
  <COLLECTION Entries="2">
    <TRACK TrackID="1" Name="Windowlicker" Artist="Aphex Twin" Album="Windowlicker"
      AverageBpm="118.00" Tonality="Fm" TotalTime="366"
      Location="file://localhost/C:/M%C3%BAsica/Aphex%20Twin/Windowlicker.mp3">
      <TEMPO Inizio="0.512" Bpm="118.00" Metro="4/4" Battito="1"/>
      <POSITION_MARK Name="Intro" Type="0" Start="0.512" Num="0"/>
      <POSITION_MARK Name="Drop" Type="0" Start="64.512" Num="1"/>
      <POSITION_MARK Name="" Type="0" Start="128.512" Num="-1"/>
    </TRACK>
    <TRACK TrackID="2" Name="Rej" Artist="&#226;me" AverageBpm="124.00" TotalTime="480"
      Location="file://localhost/C:/M%C3%BAsica/Rej.aiff">
      <TEMPO Inizio="0.250" Bpm="124.00" Metro="4/4" Battito="3"/>
      <TEMPO Inizio="120.250" Bpm="124.50" Metro="4/4" Battito="1"/>
      <POSITION_MARK Name="A" Type="0" Start="8.0" Num="-1"/>
      <POSITION_MARK Name="B" Type="0" Start="16.0" Num="-1"/>
    </TRACK>
  </COLLECTION>
  <PLAYLISTS>
    <NODE Type="0" Name="ROOT" Count="1">
      <NODE Name="Sesión" Type="1" KeyType="0" Entries="1">
        <TRACK Key="1"/>
      </NODE>
    </NODE>
  </PLAYLISTS>
</DJ_PLAYLISTS>`;

describe('leer la colección de rekordbox', () => {
  const { pistas, esRekordbox } = leerColeccion(COLECCION);

  it('reconoce el fichero y saca las pistas de la colección, no las de las listas', () => {
    // Las de `PLAYLISTS` son referencias por `Key`, sin datos: si se leyeran,
    // cada canción entraría otra vez y vacía.
    expect(esRekordbox).toBe(true);
    expect(pistas).toHaveLength(2);
    expect(pistas[0].nombre).toBe('Windowlicker');
    expect(pistas[0].artista).toBe('Aphex Twin');
  });

  it('descodifica la ruta, con acentos y con la unidad de Windows', () => {
    expect(pistas[0].ruta).toBe('C:/Música/Aphex Twin/Windowlicker.mp3');
    expect(rutaDeLocation('file://localhost/Users/dj/A%20B.wav')).toBe('/Users/dj/A B.wav');
    expect(rutaDeLocation('')).toBe('');
    // Un porcentaje suelto no puede tirar la importación entera.
    expect(rutaDeLocation('file://localhost/x/100%.mp3')).toBe('/x/100%.mp3');
  });

  it('resuelve las entidades del texto', () => {
    expect(pistas[1].artista).toBe('âme');
  });

  it('trae el tempo y la tonalidad tal como los tenía', () => {
    expect(pistas[0].bpm).toBeCloseTo(118, 3);
    expect(pistas[0].tono).toBe('Fm');
    expect(pistas[0].duracion).toBe(366);
  });

  it('avisa cuando la rejilla era de tramos y aquí solo cabe una', () => {
    expect(pistas[0].rejilla.variable).toBe(false);
    expect(pistas[1].rejilla.variable).toBe(true);
  });

  it('un documento que no es una colección no da pistas y lo dice', () => {
    expect(leerColeccion('<html><body>no</body></html>').esRekordbox).toBe(false);
    expect(leerColeccion('').pistas).toEqual([]);
    expect(leerColeccion(null).pistas).toEqual([]);
    expect(leerColeccion('<COLLECTION></COLLECTION>').pistas).toEqual([]);
  });

  it('no se atraganta con comentarios ni con CDATA', () => {
    const raro = `<COLLECTION><!-- <TRACK Name="fantasma"/> -->
      <TRACK Name="real" AverageBpm="120"><![CDATA[<TRACK Name="otro"/>]]></TRACK></COLLECTION>`;
    const leidas = leerColeccion(raro).pistas;
    expect(leidas).toHaveLength(1);
    expect(leidas[0].nombre).toBe('real');
  });
});

describe('la rejilla', () => {
  it('el desfase sale del primer golpe y el «uno», del compás que dice', () => {
    // Inizio 0,512 a 118 bpm: el periodo son 0,50847 s, así que el golpe
    // marcado es el SEGUNDO de la rejilla —el primero cae en 0,0035— y
    // `Battito=1` dice que ese segundo golpe es el uno del compás.
    const rejilla = rejillaDeTempos([{ Inizio: '0.512', Bpm: '118.00', Battito: '1' }], 118);
    expect(rejilla.bpm).toBeCloseTo(118, 3);
    expect(rejilla.offset).toBe(0.004);
    expect(rejilla.tiempoFuerte).toBe(1);
  });

  it('y si el golpe marcado es el tercero del compás, el uno queda dos antes', () => {
    const bpm = 120;
    const periodo = 60 / bpm;
    // Un golpe exactamente cuatro periodos después del cero, marcado como el 3.
    const rejilla = rejillaDeTempos([{ Inizio: String(4 * periodo), Bpm: String(bpm), Battito: '3' }], bpm);
    expect(rejilla.offset).toBeCloseTo(0, 3);
    // El golpe 4 es el tercer tiempo, así que el uno cae en el golpe 2: 4−2 = 2.
    expect(rejilla.tiempoFuerte).toBe(2);
  });

  it('sin tempo ninguno no se inventa rejilla', () => {
    expect(rejillaDeTempos([], 0)).toBe(null);
    expect(rejillaDeTempos([], null)).toBe(null);
    // Pero con el tempo medio del archivo, sí: es mejor que nada.
    expect(rejillaDeTempos([], 128).bpm).toBe(128);
  });
});

describe('los puntos de referencia', () => {
  it('los de acceso rápido van a su pad', () => {
    const cues = cuesDeMarcas([
      { Name: 'Intro', Start: '0.512', Num: '0' },
      { Name: 'Drop', Start: '64.512', Num: '1' },
    ]);
    expect(cues).toEqual([
      { n: 1, segundo: 0.512, nombre: 'Intro' },
      { n: 2, segundo: 64.512, nombre: 'Drop' },
    ]);
  });

  it('los de memoria rellenan los pads que quedan libres', () => {
    const cues = cuesDeMarcas([
      { Name: 'Intro', Start: '1', Num: '0' },
      { Name: 'A', Start: '8', Num: '-1' },
      { Name: 'B', Start: '16', Num: '-1' },
    ]);
    expect(cues.map((c) => c.n)).toEqual([1, 2, 3]);
    expect(cues[1].segundo).toBe(8);
  });

  it('los pads de más de rekordbox no caben y no se cuelan', () => {
    const cues = cuesDeMarcas([
      { Start: '1', Num: '0' }, { Start: '2', Num: '1' }, { Start: '3', Num: '2' },
      { Start: '4', Num: '3' }, { Start: '5', Num: '4' }, { Start: '6', Num: '7' },
      { Start: '7', Num: '-1' },
    ]);
    expect(cues.map((c) => c.n)).toEqual([1, 2, 3, 4]);
  });

  it('una marca sin instante no es una marca', () => {
    expect(cuesDeMarcas([{ Num: '0' }, { Start: 'x', Num: '1' }])).toEqual([]);
  });
});

describe('emparejar con la biblioteca', () => {
  const canciones = [
    { id: 'a', path: 'C:\\Música\\Aphex Twin\\Windowlicker.mp3', title: 'Windowlicker', artist: 'Aphex Twin', duration: 366 },
    { id: 'b', path: '/otro/disco/Rej.aiff', title: 'Rej', artist: 'âme', duration: 480 },
    { id: 'c', path: '/x/Distinta.mp3', title: 'Rej', artist: 'âme', duration: 200 },
  ];

  it('empareja por la ruta aunque cambien las barras y las mayúsculas', () => {
    const { parejas } = emparejar([{ ruta: 'c:/música/aphex twin/Windowlicker.mp3', nombre: '', artista: '', duracion: 366 }], canciones);
    expect(parejas[0].track.id).toBe('a');
    expect(parejas[0].como).toBe('ruta');
  });

  it('y por el nombre del archivo cuando la biblioteca se ha movido de sitio', () => {
    const { parejas } = emparejar([{ ruta: '/D:/copia/Rej.aiff', nombre: '', artista: '', duracion: 480 }], canciones);
    expect(parejas[0].track.id).toBe('b');
    expect(parejas[0].como).toBe('archivo');
  });

  it('por título y artista solo si además cuadra la duración', () => {
    const bien = emparejar([{ ruta: '', nombre: 'Rej', artista: 'AME', duracion: 481 }], canciones);
    expect(bien.parejas[0].track.id).toBe('b');
    // La versión corta no es la misma canción, por mucho que se llame igual.
    const mal = emparejar([{ ruta: '', nombre: 'Rej', artista: 'âme', duracion: 90 }], canciones);
    expect(mal.parejas).toEqual([]);
    expect(mal.huerfanas).toHaveLength(1);
  });

  it('lo que no encuentra pareja se cuenta, no se calla', () => {
    const { parejas, huerfanas } = emparejar(
      [{ ruta: '/no/existe.mp3', nombre: 'Nada', artista: 'Nadie', duracion: 10 }],
      canciones,
    );
    expect(parejas).toEqual([]);
    expect(huerfanas).toHaveLength(1);
  });
});
