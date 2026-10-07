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

## Entrada, alertas y cortes

- Todo viaja cifrado por https (tracking.sekaidevec.com). Los puertos 80 y
  999 llevan el panel a https; el 999 sigue atendiendo a las versiones viejas
  de la app mientras se actualizan.
- Tres claves equivocadas seguidas bloquean la cuenta 15 minutos, en el panel
  y en la app. En Usuarios se ve "Bloqueada hasta" y se puede desbloquear.
- Una cuenta solo puede tener la app abierta en un teléfono. Para cambiar de
  teléfono, en Usuarios se cierra la sesión del anterior. Volver a entrar
  desde el mismo teléfono sí se permite.
- La app manda un diagnóstico cada 10 minutos, y al momento cuando se apaga o
  enciende la ubicación. Con la jornada abierta, el servidor compara con el
  anterior y avisa en la campana y en la línea de tiempo si apagó el GPS,
  quitó el permiso de ubicación, puso la app en ahorro de batería o se quedó
  con batería crítica. El servicio de recuperación avisa cuando el teléfono
  deja de reportar 15 minutos con la jornada abierta y cuando vuelve.
- Cada corte del recorrido dice su causa: teléfono apagado, GPS apagado, sin
  permiso, app detenida o sin datos (no llegó ningún diagnóstico) o sin señal
  GPS (la app seguía viva).
- Al iniciar la jornada, la pantalla de la app muestra "Registrada HH:MM"
  cuando el servidor la confirmó, o "Sin confirmar" mientras se reintenta.

## Actividades, clientes y el botón Actualizar

- En el cronograma de la app, las paradas del día que el GPS registró y que
  no tienen actividad aparecen como "Detenido 09:23–09:46 · Registrar". Al
  tocarla, la actividad se crea con las horas de la parada y ofrece primero
  los clientes que están cerca. Se puede llenar en la noche o al día
  siguiente: las horas salen del GPS, no se escriben.
- Clientes: la lista se arma en el panel (se puede pegar desde Excel:
  "Nombre | Dirección | latitud, longitud") y crece sola: si alguien registra
  una visita a un cliente que no está, se agrega con la ubicación de esa
  parada.
- El cronograma del panel no juzga cuándo se cargó la actividad. Dice si el
  recorrido la respalda: "Respaldada por GPS" (estuvo detenido a esa hora, y en
  el cliente si tiene ubicación), "Lejos del cliente", "En movimiento a esa
  hora" o "Sin recorrido a esa hora". Vacaciones y permisos no se comprueban.
- El botón Actualizar de la app sube lo pendiente, manda el diagnóstico y
  pregunta al servidor qué tiene: "Al día · el servidor tiene tu ubicación de
  las 10:42". Si algo falla solo muestra lo que la persona puede arreglar
  (datos, GPS, ahorro de batería) y el siguiente toque lleva al ajuste.
  Tocarlo seguido (30 s) solo repite el último resultado.

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
  lo último que pasó. Al pasar el cursor por una persona sale su nombre, su
  departamento, la dirección de su última parada y un acceso a su repetición.
- Seguimiento: el mapa con cada persona moviéndose en vivo, agrupadas por
  departamento (el grupo al que pertenece la persona en Grupos).
- Repetición de ruta: el recorrido de una jornada, con paradas y viajes. Los
  tramos en que el teléfono no mandó puntos se dibujan por las calles con el
  servicio de ruteo y se marcan como estimados, nunca como GPS. Al pasar el
  cursor por la línea sale la hora, la velocidad y la batería del punto más
  cercano; sobre una línea punteada, cuánto duró el corte y cuánto se movió. Al reproducir, lo que falta
  se atenúa y las paradas pasan rápido. Atajos: Espacio reproduce o pausa, ← y
  → avanzan un punto (con Mayús, diez), N y P saltan a la parada siguiente o
  anterior, + y - cambian la velocidad.
- Reportes: el cronograma de actividades de cada persona y los recorridos
  (distancias, viajes y paradas).
- Batería: el estado de los teléfonos.
- Historial: quién trabajó cada día, con entrada, salida y horas.
- Usuarios, Grupos y Configuración: administración.
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
