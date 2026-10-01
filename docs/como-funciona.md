# Cómo funciona

## La jornada en el teléfono

La persona entra a la app con su usuario y toca "Iniciar jornada". Desde ese
momento la app pide la ubicación al GPS de forma continua. No guarda todo lo
que llega: si la persona está quieta descarta el temblor del GPS, si gira en
una esquina guarda ese punto aunque no toque, y descarta los saltos
imposibles. Mientras se mueve guarda más seguido y estando quieta, menos.

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

## El panel

El panel web es una aplicación React que habla solo con la API
(`servidor/api`, rutas `/api/v1/...`). Tiene estas pantallas:

- Inicio: resumen del día.
- En vivo: el mapa con la última posición de cada persona.
- Historial y Replay: el recorrido de un día, con paradas y viajes. Los tramos
  en que el teléfono no mandó puntos se dibujan por las calles con el
  servicio de ruteo y se marcan como estimados, nunca como GPS.
- Reportes: paradas, viajes y resumen por persona y por fecha.
- Batería: el estado de los teléfonos.
- Cronograma: las actividades que cargó cada persona.
- Grupos, Usuarios y Configuración: administración.
- Sistema: salud del servidor.

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
