# Tracking

Recibe todo lo que mandan los teléfonos: puntos de ruta, jornadas,
cronograma, estado del teléfono e inicio de sesión. También les dice si hay
una versión nueva de la app. Escribe en la base de datos y no tiene pantalla.

Escucha en el puerto 5055. Los teléfonos llegan por el puerto 999 de nginx.

## Arrancar

```bash
npm ci
node24 src/servidor.js
```

En el servidor lo arranca el servicio `dmj-tracking`, con el `.env` de la
raíz del proyecto.

## Rutas

- `/` (GET o POST): un punto suelto en formato OsmAnd. Lo usan las versiones
  viejas de la app.
- `POST /api/mobile/v1/sesion`: inicio de sesión.
- `POST /api/mobile/v1/positions`: lote de hasta 50 puntos.
- `GET` y `POST /api/mobile/v1/journey`: jornada.
- `GET` y `POST /api/mobile/v1/actividades`: cronograma.
- `POST /api/mobile/v1/diagnostics` y `/power`: estado del teléfono.
- `GET /api/mobile/v1/config`: configuración para la app.
- `GET /api/mobile/v1/ota`: versión publicada (lee `ota/latest.json`).
- `POST /api/mobile/v1/fcm-token` y `/recovery-ack`: notificaciones de
  recuperación.

Cada pedido lleva `X-Device-Id` y, para autenticarse, el token de la sesión
(`Authorization: Bearer`) o la clave compartida (`X-Api-Key`, que es
`DMJ_CLAVE_MOVIL`). Mientras se cambia esa clave, la anterior sigue valiendo
si está en `DMJ_CLAVE_MOVIL_ANTERIOR`.

## Pruebas

```bash
node24 --test test/*.test.mjs
node24 src/smoke.mjs     # prueba contra la base real y la deja como estaba
```
