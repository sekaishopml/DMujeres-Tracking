# Próximos cambios

## Pasar los teléfonos al identificador com.dmujeres.tracking

La app ya se compila como `com.dmujeres.tracking`. Para Android es otra app
distinta de `com.dmujeres.traccar`, así que no hay actualización automática.
Antes de publicar la primera versión con el nombre nuevo:

1. Registrar en Firebase una app Android nueva con `com.dmujeres.tracking` y
   bajar su `google-services.json` a `/opt/dmj-keys`. Sin ese archivo no
   compila la variante `google`.
2. Firmar con la misma llave de siempre (86:7B:A1:29).
3. En cada teléfono: cerrar la jornada, dejar que se vacíe la cola de puntos
   (en el menú de depuración se ve), desinstalar la app vieja e instalar la
   nueva. Después entrar con el mismo usuario y volver a dar los permisos.

Conviene hacerlo con todos los teléfonos a la vez en una reunión, porque cada
uno tarda unos minutos. No publicar el APK nuevo en el canal de actualización
hasta entonces: los teléfonos con la app vieja no lo recibirían como
actualización.

## Otros pendientes

- Prueba de carga con toda la flota mandando puntos a la vez y cálculo del
  espacio en disco que ocupa cada mes de puntos.
- Un índice sobre `lower(identificador)` en la tabla de equipos, porque
  varias consultas buscan por ese campo sin distinguir mayúsculas.
- HTTPS con dominio propio para el panel (hay un ejemplo en
  `infraestructura/nginx/dmj-tracking-tls.example`).
- Instalar el plugin `docker compose` (versión 2) en el servidor; hoy solo
  está el `docker-compose` viejo, que no lee el archivo de la base.
