# Recuperación

Proceso que corre de fondo y revisa cada minuto qué teléfonos tienen la
jornada abierta pero dejaron de reportar. A esos les manda una notificación
por Firebase que despierta la app y le pide una ubicación nueva. Así se
recuperan los teléfonos que el ahorro de batería dejó dormidos.

## Cómo decide

1. Mira los equipos habilitados que tienen un token de notificaciones válido.
2. Elige los que tienen la jornada abierta y llevan más de
   `DMJ_RECUPERACION_SILENCIO_MIN` minutos sin reportar.
3. No insiste: espera `DMJ_RECUPERACION_COOLDOWN` segundos entre intentos al
   mismo teléfono y no manda más de `DMJ_RECUPERACION_MAX_HORA` por hora.
4. Cada aviso queda guardado en `operations.dmt_alerta`. Cuando la app
   responde (`/api/mobile/v1/recovery-ack`), el aviso pasa a recibido.

Con `DMJ_RECUPERACION_DRY_RUN=1` hace todo menos mandar la notificación, para
probar sin molestar a nadie.

## Requisitos

- La cuenta de servicio de Firebase (un JSON). Se guarda fuera del proyecto,
  con permisos 600, y su ruta va en `DMJ_FCM_CREDENCIAL`.
- El `.env` de la raíz del proyecto.

## Arrancar

```bash
npm ci
node24 src/index.js
node24 src/smoke.mjs     # prueba rápida
```

En el servidor lo arranca el servicio `dmj-recuperacion`.
