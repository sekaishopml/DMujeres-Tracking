# El servidor por dentro

Guía técnica del backend: qué servicio hace qué, dónde está cada regla y qué
cambiar para cada cosa. La visión general está en [Cómo funciona](como-funciona.md).

## Servicios

Todo corre en el mismo servidor, desde `/home/DMujeres-Tracking`, con systemd.

| Servicio | Carpeta | Puerto | Qué hace |
|---|---|---|---|
| `dmj-tracking` | `servidor/tracking` | 5055 | Recibe a los teléfonos (`/api/mobile/v1`, OsmAnd, Overland) y escribe en la base |
| `dmj-api` | `servidor/api` | 8081 | API del panel (`/api/v1`): lee la base, arma recorridos y reportes |
| `dmj-panel` | `servidor/web` | 8999 | Sirve `panel/dist` y pasa `/api/*` a la API |
| `dmj-recuperacion` | `servidor/recuperacion` | — | Cada minuto busca teléfonos en silencio y los despierta por push (FCM) |
| `dmj-routing` | `servidor/ruteo` | 8992 (solo local) | GraphHopper con el mapa de Ecuador: ajuste a calles y rutas |
| `dmt-db` (docker) | `base-de-datos` | 5432 | PostgreSQL |

Nginx publica el puerto 999 para los teléfonos y el dominio del panel.
Reiniciar después de cambiar código: `sudo systemctl restart dmj-api` (o el
servicio que corresponda). El panel no se reinicia: basta `vite build`.

### Recorrido de un punto

1. La app guarda el punto en su base local y lo sube en lotes de hasta 50
   (`POST /api/mobile/v1/positions`).
2. `tracking` valida la sesión, descarta duplicados (arranque + secuencia) y
   lo escribe en `tracking.dmt_posicion`, particionada por mes. Las
   particiones del mes actual y los dos siguientes se crean al arrancar, y
   cualquier otra al insertar.
3. El panel pide `GET /api/v1/replay/:equipo`. La API lee los puntos, los
   depura, calcula cortes y causas, ajusta a calles y devuelve todo.
4. El panel arma paradas y dibuja (ver [Repetición de ruta](repeticion-de-ruta.md)).

## API del panel (`servidor/api/src`)

`servidor.js` arranca el HTTP y `rutas.js` tiene la tabla de rutas. El resto
está por tema:

| Carpeta | Archivos | Para qué |
|---|---|---|
| `base/` | `db`, `entorno`, `errores`, `http`, `log`, `dto` | Conexión, `.env`, errores del contrato, utilidades HTTP, filas SQL a JSON |
| `acceso/` | `auth`, `sesiones`, `permisos`, `roles`, `secciones`, `panel`, `cuentas`, `usuarios`, `grupos`, `bajas` | Entrar al panel, quién ve qué, cuentas de personas y del panel, grupos, bajas |
| `equipos/` | `flota`, `posiciones`, `vivo`, `bateria`, `salud`, `esquema`, `config`, `consola` | Teléfonos, posición en vivo, avisos en vivo (SSE), batería, salud, ajustes remotos de la app, consola de Sistema |
| `recorrido/` | `replay`, `depuracion`, `ruteo`, `geo`, `causas`, `jornadas`, `eventos`, `paradas`, `segmentos` | Todo lo que arma un recorrido |
| `lugares/` | `geocercas`, `geocodigo`, `clientes` | Geocercas, direcciones (Nominatim con caché en `.cache/`), clientes |
| `reportes/` | `reportes`, `reporteMarketing`, `cronograma` | Viajes, paradas y resumen; Excel de Marketing; cronograma |

Excel de Marketing: llena la plantilla `plantillas/Reporte_Marketing.xlsm`
(las personas son las filas de la plantilla; para sacar o poner a alguien se
cambia la plantilla). Solo se llenan encendido y apagado; las demás columnas
quedan como en la plantilla. Son de referencia: la ruta se revisa en el replay.
- Encendido: la hora en que la persona inició la jornada. Si seguía abierta de
  antes (no la finalizó; la jornada sigue sin límite y la app solo la parte a
  medianoche), el primer punto del día desde las 0:00, o 0:00 sin puntos.
- Apagado: la hora en que la finalizó; si no, el último punto del día.

Las pruebas están en `servidor/api/test` (`node24 --test test/*.test.mjs`).

### Rutas

Todas bajo `/api/v1`, con la cookie de sesión salvo `health`, `ready`,
`version` y `auth/login`.

- Sesión: `auth/login`, `auth/logout`, `auth/me`.
- Equipos: `fleet`, `fleet/:id`, `fleet/:id/position`, `fleet/:id/journeys`,
  `journeys`, `positions/live`, `vivo`, `battery`, `battery/:id`, `salud`,
  `salud/historial`, `config`, `configuracion/esquema`, `consola`.
- Recorrido: `replay`, `replay/:id`, `eventos`.
- Reportes: `reports/trips`, `reports/stops`, `reports/summary`,
  `reports/marketing`, `cronograma`, `cronograma/novedades`, `cronograma/visto`.
- Lugares: `geocercas` (+ `:id`, `visitas`, `:id/historial`), `clientes`,
  `geocode/reverse`.
- Personas: `users`, `usuarios` (+ `desbloquear`, `definitivo`,
  `cerrar-sesion-telefono`, `equipos`), `bajas`, `grupos`, `roles`,
  `panel/opciones`, `panel/cuentas`.

## Cómo se arma un recorrido (`recorrido/replay.js`)

1. **Lectura:** puntos del equipo en la ventana, con la jornada a la que
   pertenece cada uno. Fuera de jornada no se traza (el iPhone, que no tiene
   jornadas, se traza por día).
2. **Depuración** (`depuracion.js`, `depurarPosiciones`), en este orden:
   - fuera de la zona de operación (latitud −5 a 2, longitud −93 a −74);
   - rachas imprecisas (más de 20 m) entre dos puntos precisos a 5 min o
     menos; hasta 10 min si la racha es de ubicaciones por red (mediana de
     100 m o más). Si dentro de la racha hubo ubicación al menos cada 30 s,
     el par de puntos precisos que la rodea va en `imprecisos` de la
     respuesta: se vio, aunque impreciso, y el panel lo une punteado;
   - excursión: se aleja 25 m o más a más de 3 veces la velocidad que reporta
     el teléfono (+20 km/h) y vuelve en 60 s; o vuelve en hasta 3 min si ese
     regreso tampoco cuadra (caminando, a más de 20 km/h);
   - salto de 1 km o más que vuelve en 5 min sin dar un paso (si el contador
     de pasos funciona ese día);
   - pico de ida y vuelta a más de 180 km/h; pico estando quieto; pico de
     velocidad;
   - puntos viejos que llegan después de uno mucho más preciso;
   - escapada fantasma: tramo de 5 puntos o más a más de 300 m entre dos
     silencios, que vuelve al mismo sitio;
   - despertar falso: tras 2 min sin puntos, un tramo a más de 300 m con
     velocidad de quieto que vuelve en 3 min;
   - ráfaga al despertar: puntos que se mueven sin velocidad entre dos
     silencios.
   Lo descartado se cuenta en `calidad` (el panel lo muestra en Integridad).
3. **Cortes** (`geo.js`, `calcularHuecos`): 10 min o más sin puntos
   (`UMBRAL_HUECO_SEGUNDOS`). Entre dos jornadas el corte es `FUERA_DE_JORNADA`.
4. **Causa de cada corte** (`causas.js`): mira los eventos de la app en ese
   rato (GPS apagado, sin permiso, apagado, sin contacto) para decir por qué.
5. **Ajuste a calles** (`ruteo.js`, `reconstruirTramos`):
   - Ventanas con puntos: `/match` de GraphHopper (MATCHED). Se descarta si
     el largo sale fuera de 0,75–1,25 veces el original, si los puntos quedan
     lejos del trazo, si casi todo es impreciso, o si con GPS de 5 m o mejor
     el trazo se aparta más de 12 m (percentil 90).
   - Un hueco sin puntos **no se rellena por calles** (decisión del 28/10):
     cada novedad del recorrido se audita y un camino que nadie vio no se
     dibuja. Queda como corte naranja.
   - Presupuesto: 3 s por recorrido; el resto queda recto.
6. **Resumen** (`geo.js`, `resumirRecorrido`): distancia, duración,
   velocidades, batería, pasos.

Paradas para reportes: `paradas.js` (permanencia en 60 m) y `segmentos.js`
(viajes y paradas por velocidad). `tracking/src/clientes.js` usa
`recorrido/paradas.js` para sugerir clientes a la app.

## Receptor de teléfonos (`servidor/tracking/src`)

- `servidor.js`: rutas y arranque (precrea particiones).
- `movil.js`: todo `/api/mobile/v1` (sesión, puntos, jornada, actividades,
  diagnóstico, config, OTA por equipo en `ota/por-equipo/<identificador>.json`).
- `db.js`: escritura idempotente de puntos y eventos.
- `osmand.js`: protocolo de las apps viejas. **No se toca.**
- `overland.js`: iPhone (app Overland).
- `alertas.js`, `salud.js`, `estado.js`, `clientes.js`.

Los valores por defecto de la config de la app deben coincidir entre
`tracking/src/movil.js` y `api/src/equipos/esquema.js`.

## Recuperación (`servidor/recuperacion/src`)

`monitor.js` busca equipos con jornada abierta que llevan rato sin reportar y
decide si mandar push; `fcm.js` lo envía; `avisos.js` manda los avisos de
horario. Solo escribe en sus tablas de seguimiento.

## Base de datos

Esquema base en `base-de-datos/schema`, cambios en `base-de-datos/migrations`
(numerados; se aplican a mano y en orden).

- `tracking`: `dmt_dispositivo`, `dmt_posicion` (por mes), `dmt_posicion_actual`,
  `dmt_evento` (por mes).
- `operations`: jornadas y sus tramos, actividades, clientes, geocercas y su
  historial, alertas, asignaciones equipo–persona.
- `iam`: usuarios, grupos, roles, sesiones del panel, tokens FCM, claves.
  La sesión del teléfono no vence: dura hasta que se quita desde el panel
  (cerrar sesión del teléfono o deshabilitar la cuenta). Un teléfono que perdió
  el token recupera la suya con `POST /api/mobile/v1/sesion/recuperar
  {instalacion}` (solo si sigue viva). `GET /api/mobile/v1/ota` no pide sesión:
  el APK ya es público y así le llega la versión a un teléfono sin sesión. (Hasta el
  11/11 vencía a los 30 días y los teléfonos quedaban sin poder enviar.)
- `system`: configuración y versión del esquema.

Consola: `docker exec -i dmt-db psql -U dmt -d dmujeres`. Las pruebas que
escriben van contra la copia `dmj_vis`.

## Dónde cambiar qué

| Quiero cambiar… | Archivo |
|---|---|
| Qué puntos se descartan antes de dibujar | `api/src/recorrido/depuracion.js` (y en el panel `panel/src/dominio/depuracion.ts`) |
| Cuándo un salto es corte y su causa | `api/src/recorrido/geo.js`, `causas.js` |
| Ajuste a calles | `api/src/recorrido/ruteo.js`; el motor en `servidor/ruteo` |
| Paradas de los reportes | `api/src/recorrido/paradas.js`, `segmentos.js` |
| Paradas y dibujo de Repetición de ruta | `panel/src/dominio/paradasUnidas.ts`, `panel/src/componentes/replay/trazo.ts` |
| Ajustes que la app recibe del servidor | `api/src/equipos/esquema.js` + `tracking/src/movil.js` |
| Qué versión de la app recibe cada teléfono | `ota/latest.json` y `ota/por-equipo/` |
| Quién ve qué en el panel | `api/src/acceso/permisos.js`, `secciones.js`, `panel.js` |

## Qué falta mejorar

- El ajuste a calles mezcla puntos crudos cuando no casan (`servidor/ruteo`,
  Java) y deja ganchos con GPS impreciso.
- El mismo recorrido puede salir distinto según cuándo se pida: el ajuste a
  calles tiene un tope de 3 s por recorrido y las direcciones se calculan la
  primera vez. Para auditorías conviene que un día cerrado se vea siempre
  igual (guardar el resultado de los días cerrados).
- La partición `dmt_posicion_2037_10` está vacía (la creó un punto con la
  fecha mal puesta, que el receptor ya rechaza); se puede borrar.

Resuelto el 27/10: la velocidad máxima ya no toma picos del GPS. Es la
sostenida (`velocidadMaximaSostenidaKmh` en `geo.js` y `vel_sostenida` en
`segmentos.js`): la mayor que se mantuvo en 3 puntos seguidos de 30 m o
mejor, contando en cada punto lo menor entre lo reportado y lo que avanzó.
En la flota bajó de 98 a 0 los días con más de 130 km/h.
