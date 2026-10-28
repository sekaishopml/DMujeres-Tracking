# La app Android

El código está en `app/`. El paquete del código es `com.dmujeres.app`, pero
el identificador de instalación es `com.dmujeres.tracking`. Los teléfonos que
tienen la versión anterior (`com.dmujeres.traccar`) no la actualizan: hay que
pasarlos a mano (ver [Próximos cambios](proximos-cambios.md)).

## Carpetas del código

Dentro de `com.dmujeres.app`: `pantallas` (las vistas), `seguimiento` (GPS,
movimiento y servicio), `red` (envío al servidor), `sesion` (entrada, cierre y
cola de jornada), `datos` (base local y preferencias), `sistema` (arranque,
batería y avisos del teléfono), `actualizacion`, `jornada`, `captura`,
`envio`, `movimiento`, `recuperacion` y `cronograma`. Las variantes `google`
y `regular` repiten solo lo que cambia: `google` usa los servicios de Google
(ubicación fusionada y avisos push) y `regular` usa la ubicación del sistema.

## Llaves y archivos que no están en git

La compilación lee de `/opt/dmj-keys` (o de la carpeta que diga la variable
`DMJ_CLAVES`):

- `release.keystore` y `keystore.properties`: la firma de la app. Sin esa
  firma exacta los teléfonos rechazan la actualización.
- `debug.keystore`.
- `google-services.json`: la configuración de Firebase.
- `secrets.properties`: la clave compartida que trae la app de fábrica.

Esa carpeta hay que respaldarla aparte y con cuidado. Si se pierde la llave de
firma, no hay forma de actualizar los teléfonos sin desinstalar la app.

## Compilar

```bash
cd app
export ANDROID_HOME=/opt/android-sdk
./gradlew assembleGoogleRelease
./gradlew testGoogleReleaseUnitTest
```

Hay dos variantes: `google`, que es la que se usa y trae ubicación de Google
y notificaciones, y `regular`, sin servicios de Google.

## Cómo se actualizan los teléfonos

La app pregunta al servidor (`/api/mobile/v1/ota`) si hay una versión mayor
que la instalada (compara el versionCode). Si el puerto 999 no responde, mira
el último release de GitHub del repositorio `sekaishopml/DMujeres-Tracking`.
El servidor responde con `ota/por-equipo/<identificador>.json` si existe para
ese equipo, y si no con `ota/latest.json`.

Cuándo pregunta y qué hace:

- Cuando la pantalla principal se crea desde cero (app cerrada del todo y
  abierta de nuevo): si hay versión nueva, abre sola la pantalla de
  actualización, descarga e instala.
- Al volver a la app que seguía abierta en segundo plano, y cada minuto con
  la app en pantalla: solo baja el aviso de arriba ("Actualizar a la X"). No
  abre nada solo, para no cortar lo que la persona está escribiendo. Al tocar
  el aviso se actualiza.

Cómo instala:

- Desde la 2.10.1, en Android 12 o superior y con el permiso "instalar apps
  desconocidas" concedido, instala sin preguntar (sesión de PackageInstaller
  con `UPDATE_PACKAGES_WITHOUT_USER_ACTION`). La app se cierra al
  reemplazarse y `AutostartReceiver` (`MY_PACKAGE_REPLACED`) vuelve a arrancar
  el seguimiento si había jornada abierta.
- Si el sistema exige confirmar igual, se abre su pantalla de "Instalar".
- En Android 11 o anterior, o desde una versión anterior a la 2.10.1 (que
  instala a la antigua), Android pide tocar "Instalar". Por eso el paso de la
  2.9.5 a la 2.10.1 todavía pide confirmación; la siguiente ya no.
- Sin el permiso de instalar, el aviso de arriba lo pide y abre el ajuste.

Antes de instalar se revisa el sha256 del APK descargado contra el del json;
si no coincide se descarta.

Los teléfonos con la versión 2.4.1 o anterior todavía buscan en el
repositorio viejo, `sekaishopml/Dmujeres-Traccar`. Ese repositorio tiene que
seguir público hasta que todos tengan la 2.4.2 o una posterior.

## Primer uso en un teléfono nuevo

1. Instalar el APK de `http://68.168.20.219:999/` (el último publicado).
2. Entrar con el usuario y la clave creados en el panel (Usuarios).
3. Dar todos los permisos que pide: ubicación todo el tiempo, actividad
   física, notificaciones y sin restricción de batería.
4. En marcas como Xiaomi, Huawei u Oppo, activar el inicio automático desde
   el botón que muestra la app.

La captura por dentro (proveedores, movimiento, filtros) está en
[Cómo captura la app](app-captura.md).

## Qué hace la app según la jornada

Con la jornada abierta: servicio en primer plano ("Jornada activa"), GPS cada
segundo, alarma de supervisión cada 3 minutos y aviso por push si deja de reportar.

Sin jornada: el servicio sigue vivo pero en espera. No pide ubicación, no
arma la cerca de quietud, no corre el vigilante del GPS ni la alarma de
rescate, y ignora los avisos de recuperación. Solo manda el latido de
diagnóstico cada 10 minutos (batería, permisos y versión, sin coordenadas) y
vacía la cola de puntos pendientes. Al abrir la jornada todo se enciende.

## Depuración

Tocando 5 veces la versión en la pantalla principal se abre un menú con el
estado interno de la app, la cola de puntos y el cierre de sesión.
