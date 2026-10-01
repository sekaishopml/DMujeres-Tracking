# Próximos cambios

## Pasar el identificador de la app a com.dmujeres

Hoy la app se instala como `com.dmujeres.traccar`, un nombre que viene de
antes. La idea es pasarla a `com.dmujeres`. No se puede hacer con una
actualización normal, porque para Android sería otra app distinta. Hay que:

1. Registrar en Firebase una app Android nueva con `com.dmujeres` y bajar su
   `google-services.json` a `/opt/dmj-keys`.
2. Cambiar `applicationId` en `app/app/build.gradle` y los `targetPackage` de
   `app/app/src/main/res/xml/shortcuts.xml`.
3. Firmar con la misma llave de siempre.
4. En cada teléfono: cerrar la jornada, dejar que se vacíe la cola de puntos
   (en el menú de depuración se ve), desinstalar la app vieja e instalar la
   nueva. Después entrar con el mismo usuario y volver a dar los permisos.

Conviene hacerlo con todos los teléfonos a la vez en una reunión, porque cada
uno tarda unos minutos.

## Otros pendientes

- Prueba de carga con toda la flota mandando puntos a la vez y cálculo del
  espacio en disco que ocupa cada mes de puntos.
- Un índice sobre `lower(identificador)` en la tabla de equipos, porque
  varias consultas buscan por ese campo sin distinguir mayúsculas.
- HTTPS con dominio propio para el panel (hay un ejemplo en
  `infraestructura/nginx/dmj-tracking-tls.example`).
- Instalar el plugin `docker compose` (versión 2) en el servidor; hoy solo
  está el `docker-compose` viejo, que no lee el archivo de la base.
