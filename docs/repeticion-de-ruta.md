# Repetición de ruta por dentro

Cómo el panel convierte lo que manda la API en paradas y líneas. Todo vive en
`panel/src`: la página es `paginas/Replay.tsx`, la lógica en `dominio/` y el
dibujo en `componentes/replay/`. Las pruebas están en `panel/test`
(`node24 --test test/*.test.mjs`).

Regla general: lo que se muestra puede terminar en una multa. Un dato que no
se vio no se dibuja como visto; un dato ausente se muestra "—".

## Orden de los pasos (`paginas/Replay.tsx`)

1. Puntos de la API (ya depurados por el servidor, ver [El servidor](servidor.md)).
2. `dominio/depuracion.ts`, `depurarRecorrido`:
   - quita picos de 1 a 3 puntos (ida y vuelta a más de 90 km/h con un
     rodeo mucho mayor que el camino directo);
   - agrupa estancias (60 m, 2 min o más) y lleva sus puntos al centro. No
     es estancia un rato corto caminando (60 pasos/min o más, hasta 10 min).
3. Paradas: las del servidor (`/reports/stops`) más las estancias de 3 min o
   más que el servidor no vio.
4. `dominio/paradasUnidas.ts`, `unirParadasSinSalir` (ver abajo).
5. Rótulo de geocerca: `componentes/geocercas/logica.ts`, `ubicarEnGeocerca`
   (3 puntos o más de 50 m o mejor adentro y, si el centro no cae adentro,
   el 20 % de las lecturas).
6. `componentes/replay/trazo.ts`:
   - `descartarAjustesLejanos` (ajuste a calles corrido del GPS preciso);
   - `segmentosParaDibujar` (líneas, cortes, uniones y costura).
7. `componentes/replay/flechas.ts`: líneas con hora por vértice, flechas y
   hora bajo el cursor.

## Paradas (`dominio/paradasUnidas.ts`)

**¿Salió de verdad?** (`salioDeVerdad`). Para cortar una parada en dos hace
falta todo esto:

- 3 puntos de 30 m o mejor a más de 150 m;
- sin saltos imposibles (más de 130 km/h en más del 5 % de los pares);
- un ir y volver a 40 km/h o menos de promedio;
- sin enredo: el recorrido no más largo que 2,5 × 2 × la distancia máxima.

Además, según los sensores del teléfono:

- **Pasos:** si el contador funciona ese día (sube 100 o más con 20 valores
  distintos), hacen falta 30 pasos o más. Ir en carro no suma pasos, así que
  se acepta también con 3 puntos a 15 km/h o más, salvo que la actividad diga
  "quieto".
- **Actividad:** si el teléfono se reportó quieto y nunca en movimiento, no
  salió. Google deja de avisar mientras sigue quieto: un lapso sin lecturas
  después de "quieto" sigue siendo quieto.
- **Sin pasos ni actividad** (Huawei sin Google, iPhone): decide solo la
  física.

**Unir y cortar:**

- Dos paradas a 150 m o menos se unen si no salió. Excepción
  (`cambioDeSitio`): si entre ellas caminó (pasos a ritmo de marcha) y en la
  segunda casi todas las lecturas precisas quedan a más de 80 m durante 10 min
  o más, son dos lugares (David 01/11: oficina y un local a 130 m).
- Se quitan las paradas cortas entre dos estancias en el mismo lugar si en
  todo ese rato no hubo pasos ni movimiento (`sinIntercaladas`, hasta 3
  paradas y 60 min). Es el GPS clavado en otro sitio bajo techo.
- `ampliarBordes`: la estancia va del primer punto a 80 m o menos hasta el
  último antes de alejarse más de 400 m.
- `recortarColas`: si al final (o al principio) ya se había ido de forma
  sostenida (200 m, o 80 m si iba caminando), la parada termina antes.
- `partirPorViajes`: un viaje real de ida y vuelta dentro de una parada la
  parte en dos.
- `marcarCortes`: minutos sin datos dentro de la parada. La lista los muestra
  desde 5 min.

## Dibujo (`componentes/replay/trazo.ts`)

- Dentro de una parada no se dibuja el temblor: solo el halo y la insignia.
- Una salida dentro de una parada solo se dibuja si `salidasDuranteParada` la
  da por real.
- Un salto de más de 130 km/h entre dos puntos se dibuja punteado.
- Una salida sin pasos ni actividad que la respalden también va punteada.
- Cada parada se une con su línea de llegada y de salida (`conectarParadas`).
- `coser`: la ruta nunca queda partida. Unos metros se cierran con la misma
  línea; más, con la raya naranja de corte.
- Colores: línea sólida = GPS visto; punteado = GPS visto pero dudoso
  (salto imposible, salida sin pasos ni actividad) o unión corta a pie desde
  una parada; naranja con rayas = corte (no se vio). Un corte nunca se
  rellena por calles.

## Mouse y selección (`componentes/replay/ReproductorReplay.tsx`)

- La hora del globo y del clic es la del trazo bajo el cursor
  (`horaSobreTrazo`), nunca la del punto GPS más cercano. En calles recorridas
  dos veces gana la pasada del tramo señalado.
- La zona sensible al mouse es solo lo que se ve.
- Los avisos (corte, volvió, señal débil) van donde iría el marcador: dentro
  de una parada en su centro; si no, sobre la línea.
- Dentro de una parada el estado es "Detenido".
- "Descargar recorrido" exporta el GPS tal como llegó, sin depurar.

## Horas de salida y llegada: solo con prueba

Lo que se usa para auditar no puede afirmar nada que los datos no prueben.

- **Servidor** (`servidor/api/src/recorrido/paradas.js`): un punto de antena
  lejano no corta la estancia si el siguiente punto preciso vuelve al mismo
  sitio en 10 min (`vuelveAlCentro`). Dos paradas cercanas no se funden si
  caminó entre ellas y la segunda es claramente otro sitio (`cambioDeSitio`).
- **Bitácora del Detalle** (`panel/src/dominio/bitacora.ts`):
  - "Salió" con hora solo si hay un punto de 50 m o mejor a más de 80 m del
    lugar en los 15 min siguientes, sin pausas de más de 5 min, o si caminó
    a otro sitio cercano. Si no, "Último punto preciso en…" sin hora.
  - Lo mismo para "llegó" hacia atrás; si no, "primer punto preciso en…".
  - Dos paradas en el mismo lugar (100 m) sin prueba de salida entre ellas
    son una sola estancia: un apagón o un rato sin señal no es una salida.
  - Si tras un rato sin registro vuelve a aparecer en el lugar, la estancia
    llega hasta ese punto (`bordeTrasHueco`).
  - La ubicación simulada no prueba nada y sale como aviso propio.
- **Jornadas:** el inicio de las 00:00 que sigue la jornada de ayer
  (`continua`) no es una entrada, y un cierre que no hizo la persona
  (`cierreAutomatico`: medianoche o recorte al último punto) no es un
  "Finalizó". Asistencia separa esas horas como "sin cerrar".
- **Cronograma:** "Lejos del cliente" solo con una ubicación de cliente
  confirmada por una persona en Clientes; la que aprendió la app queda "sin
  confirmar" y no cuenta en contra.

## Dónde cambiar qué

| Quiero cambiar… | Archivo |
|---|---|
| Cuándo una salida es real | `dominio/paradasUnidas.ts` (`salioDeVerdad`) |
| Bordes de las paradas | `paradasUnidas.ts` (`ampliarBordes`, `recortarColas`) |
| Qué rebotes se quitan en el panel | `dominio/depuracion.ts` |
| Qué se dibuja sólido, punteado o naranja | `componentes/replay/trazo.ts` |
| Hora bajo el cursor | `componentes/replay/flechas.ts` (`horaSobreTrazo`) |
| Rótulo de geocerca | `componentes/geocercas/logica.ts` |
| Numeración de visitas | `dominio/dia.ts` (`resumenDia`) |

Para medir un cambio en toda la flota antes de publicarlo: se descargan los
recorridos y paradas de varios días y se compara la versión publicada contra
la nueva (paradas, km sólidos, km naranja, km punteados). Ningún cambio de
regla se publica sin esa comparación.

## Qué falta mejorar

- Centros de parada corridos 80 a 150 m en estancias largas.

Resuelto el 27/10:
- La ficha, el globo y la línea de tiempo muestran la velocidad que reportó
  el teléfono (`velocidadMostrada`); el 0 de las estancias es solo interno.
- Llegó/Salió de geocercas usan el rato de la parada con lecturas de 50 m o
  mejor dentro o a 60 m del borde (`componentes/geocercas/logica.ts`).
- Velocidad máxima sostenida en el servidor (ver [El servidor](servidor.md)).
