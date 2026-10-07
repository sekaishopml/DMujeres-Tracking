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

Al abrir la app, y cada minuto mientras está abierta, la app pregunta al
servidor (`/api/mobile/v1/ota`) si hay una versión mayor que la instalada. Si
el puerto 999 no responde, mira el último release de GitHub del repositorio
`sekaishopml/DMujeres-Tracking`. Si hay versión nueva aparece un aviso
arriba; al tocarlo se descarga el APK, se revisa su sha256 y Android pide
confirmar la instalación.

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

## Qué hace la app según la jornada

Con la jornada abierta: servicio en primer plano ("Jornada activa"), GPS cada
segundo, alarma de rescate cada 9 minutos y aviso por push si deja de reportar.

Sin jornada: el servicio sigue vivo pero en espera. No pide ubicación, no
arma la cerca de quietud, no corre el vigilante del GPS ni la alarma de
rescate, y ignora los avisos de recuperación. Solo manda el latido de
diagnóstico cada 10 minutos (batería, permisos y versión, sin coordenadas) y
vacía la cola de puntos pendientes. Al abrir la jornada todo se enciende.

## Depuración

Tocando 5 veces la versión en la pantalla principal se abre un menú con el
estado interno de la app, la cola de puntos y el cierre de sesión.
