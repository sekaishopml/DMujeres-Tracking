# Cómo funciona

## La jornada en el teléfono

La persona entra a la app con su usuario y toca "Iniciar jornada". Desde ese
momento la app pide la ubicación al GPS de forma continua. No guarda todo lo
que llega: si la persona está quieta descarta el temblor del GPS, si gira en
una esquina guarda ese punto aunque no toque, y descarta los saltos
imposibles. Mientras se mueve guarda más seguido y estando quieta, menos.

Sin jornada abierta la app queda en espera: apaga el GPS, no registra ni envía
ningún punto y su aviso fijo dice "Sin jornada". Al tocar "Finalizar jornada"
termina de subir lo que quedaba en la cola y deja de pedir ubicación. El
servidor tampoco despierta por push a los teléfonos sin jornada. La repetición
de ruta, además, solo dibuja lo que pasó dentro de una jornada, por si llegan
puntos de versiones viejas de la app.

Si la jornada queda abierta al pasar la medianoche, la app la cierra a las
23:59:59 y sigue como una jornada nueva desde las 00:00. Así cada día tiene la
suya.

Las actividades se manejan desde el pie de la pantalla principal: "Iniciar
actividad" abre el formulario con la hora actual y, mientras está en curso,
"Finalizar actividad" le pone la hora de fin con un toque.

Cada punto se guarda primero en el propio teléfono, en una cola, y después se
sube al servidor en lotes de hasta 50. Si no hay señal, los puntos esperan en
la cola (caben unas tres jornadas completas) y salen en orden cuando vuelve la
conexión. Un punto solo se borra del teléfono cuando el servidor confirma que
lo recibió.

Además de la ruta, la app manda:

- el inicio y el fin de la jornada, con la hora real en que se tocó el botón;
- el cronograma: las actividades del día, con hora de inicio y de fin;
- el estado del teléfono: batería, permisos, si la ubicación está apagada,
  versión de la app.

## El servidor

Los teléfonos hablan con el puerto 999. Nginx pasa todo lo que empieza por
`/api/mobile/v1` al servicio de tracking (`servidor/tracking`), que valida la
clave o la sesión del teléfono y guarda en la base. Ese mismo puerto entrega
el archivo `latest.json` y el APK de la última versión de la app.

Las rutas que usa el teléfono son:

- `POST /api/mobile/v1/sesion`: inicio de sesión, devuelve un token.
- `POST /api/mobile/v1/positions`: lote de puntos.
- `GET` y `POST /api/mobile/v1/journey`: consultar, abrir o cerrar la jornada.
- `GET` y `POST /api/mobile/v1/actividades`: el cronograma.
- `POST /api/mobile/v1/diagnostics` y `/power`: estado del teléfono.
- `GET /api/mobile/v1/config`: configuración que manda el servidor.
- `GET /api/mobile/v1/ota`: si hay una versión nueva de la app.
- `POST /api/mobile/v1/fcm-token` y `/recovery-ack`: notificaciones de
  recuperación.

El servidor no guarda dos veces el mismo punto: cada punto lleva un
identificador del arranque de la app y un número de secuencia, así que
reenviar es siempre seguro.

El servicio de recuperación (`servidor/recuperacion`) revisa cada minuto qué
teléfonos tienen la jornada abierta pero llevan rato sin reportar. A esos les
manda una notificación por Firebase que despierta la app y le pide una
ubicación nueva.

## Teléfonos iPhone

No hay app propia para iPhone. Esas personas usan Traccar Client, que se baja
gratis de la App Store. Al crear la cuenta en el panel se elige iPhone y se
copia el identificador de dispositivo que muestra Traccar Client; en el iPhone
se pone como servidor `http://68.168.20.219:5055`.

Traccar Client no avisa cuándo empieza ni cuándo termina el trabajo, así que
de eso se encarga el servidor: el primer punto del día abre la jornada y, tras
unas dos horas sin puntos, la cierra con la hora del último. También la parte
a medianoche, igual que la app Android. Lo que no tienen los iPhone es el
cronograma de actividades.

## El panel

El panel web es una aplicación React que habla solo con la API
(`servidor/api`, rutas `/api/v1/...`). Tiene estas pantallas:

- Inicio: resumen del día, personas por departamento, lo que hay que revisar y
  lo último que pasó. Al pasar el cursor por una persona sale su día: a qué
  hora salió de casa, cuándo llegó a la oficina, cuántos sitios visitó y qué
  parte del recorrido se vio.
- Seguimiento: el mapa con cada persona moviéndose en vivo, agrupadas por
  departamento (el grupo al que pertenece la persona en Grupos).
- Repetición de ruta: el recorrido de una jornada, con paradas y viajes. Los
  tramos en que el teléfono no mandó puntos se dibujan por las calles con el
  servicio de ruteo y se marcan como estimados, nunca como GPS. Al pasar el
  cursor por la línea sale la hora, la velocidad y, si la persona pasó varias
  veces por la misma calle, todas las pasadas con su sentido; sobre una línea
  punteada, cuánto duró el corte y cuánto se movió. Al reproducir, lo que falta
  se atenúa y las paradas pasan rápido. Atajos: Espacio reproduce o pausa, ← y
  → avanzan un punto (con Mayús, diez), N y P saltan a la parada siguiente o
  anterior, + y - cambian la velocidad.
- Reportes: el cronograma de actividades de cada persona y los recorridos
  (distancias, viajes y paradas).
- Batería: el estado de los teléfonos.
- Historial: quién trabajó cada día, con entrada, salida y horas.
- Usuarios, Grupos y Configuración: administración. En Configuración se fija
  la oficina (nombre, coordenadas y radio); si nadie la fija, el panel usa el
  lugar donde más personas distintas se detuvieron en 30 días y lo avisa como
  "detectada". "Casa" es la estancia donde empezó el registro del día (al menos
  10 minutos); si el registro empezó en la calle no se afirma nada.
- Sistema: salud del servidor, cifras del día y una consola para consultar la
  base (ver el [curso de SQL](curso-sql-consola.md)).

El panel no espera a preguntar cada tantos segundos. Al guardar un punto, un
evento o una actividad, el servicio de tracking avisa por PostgreSQL
(`NOTIFY dmt_vivo`). La API escucha con una sola conexión, junta los avisos y
manda como mucho uno por segundo a cada panel abierto por un canal en vivo
(`GET /api/v1/vivo`). Así el mapa y la campana se actualizan al instante sin
cargar la base, y si el canal se corta el panel vuelve a preguntar solo.

La consola de Sistema es solo para administradores y solo lee. Corre con un
rol de la base, `dmt_consulta`, que no puede ver cuentas, claves, sesiones ni
la auditoría, con un tope de 5 segundos y 200 filas. Cada comando queda en la
auditoría.

## La base de datos

PostgreSQL 18 con TimescaleDB. Los datos están separados en esquemas:

- `iam`: usuarios, roles, sesiones y tokens de notificación.
- `tracking`: equipos, puntos de ruta y jornadas.
- `telemetry`: batería y diagnóstico de los teléfonos.
- `operations`: cronograma, alertas y eventos.
- `audit`: registro de cambios.
- `system`: configuración.

Los puntos de ruta se guardan en tablas por mes, que se crean solas con
anticipación.
