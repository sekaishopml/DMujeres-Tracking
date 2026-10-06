# App Android

App de jornada de DMujeres: registra el recorrido de la persona, su
cronograma de actividades y el estado del teléfono, y lo manda al servidor.

- Paquete del código: `com.dmujeres.app`.
- Identificador de instalación: `com.dmujeres.tracking` (en desarrollo,
  `com.dmujeres.tracking.dev`). Ya no se cambia; ver
  `docs/proximos-cambios.md` para pasar los teléfonos desde el anterior.
- Compilar: `./gradlew assembleGoogleRelease` (necesita las llaves de
  `/opt/dmj-keys`).
- Publicar una versión: `scripts/publicar-app.sh X.Y.Z "qué cambió"`, desde
  la raíz del proyecto.

Más detalles en `docs/app-android.md`.

## Licencia

Parte del código viene de un cliente de código abierto con licencia Apache
2.0. Por esa licencia se conservan `LICENSE.txt` y los avisos de copyright en
los archivos que vienen de él (ver `NOTICE`).
