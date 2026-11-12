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

## Rutas sin cortes (revisión del 13/10/2026)

Se revisó el día de las 12 personas con grupo. No se perdió ningún punto
guardado: los problemas son teléfonos que congelan la app, personas que apagan
el GPS o quitan permisos, avisos de "sin señal" que no lo eran y lecturas
falsas del teléfono.

### Lo que se vio

| Persona | Qué pasó |
|---|---|
| Ana Troya | Sin cortes, 259 km. 36 rescates del servidor (el teléfono se dormía). Sus 157 km/h son reales. |
| Martha Macias | Sin pérdida, 536 km. Dos cortes de 11 y 22 min estando estacionada. Batería fija en 34 % todo el día. |
| Nadia Figueroa | Completa, 517 km. 19 avisos de "sin señal" por falta de cobertura; los puntos llegaron hasta 99 min tarde. |
| Paola Paredes | Sin cortes. 56 rescates; 27 % de puntos imprecisos bajo techo. |
| Norelys Perera | Sin cortes. 30 rescates. |
| Sofía Espinoza, Melina Rojas | Ubicación en "solo mientras se usa la app". Melina bajó de 76 % a 8 % de batería en 4,6 h. |
| Joselyn Cevallos | Corte de 78 min: el teléfono congeló la app aunque tenía todos los permisos. Velocidad falsa de 141 km/h estando quieta. |
| Jefferson Alvarez | Apagó el GPS de 15:23 a 15:57 y desde las 16:18 hasta cerrar la jornada. |
| Ariel Menéndez | Apagó el GPS mientras configuraba el teléfono. Velocidad falsa de 102 km/h. |
| Joice Obando | Creada a las 11:35, nunca se conectó. |

Estando quieta la app debe mandar un punto cada 2 min. En la práctica llegaron
cada 4 a 6 min: el 63 % de los intervalos de Martha, el 78 % de los de Paola y
todos los de Ariel pasaron de 3 min.

### Servidor

1. Si el teléfono no se movió, no usar la velocidad que reporta (quita los
   102 y 141 km/h falsos).
2. Un corte que empieza y termina en el mismo lugar se muestra como
   "detenida, sin puntos" y no como "sin señal".
3. Si después llegan los puntos atrasados que cubren un silencio, marcarlo
   como "sin cobertura, ruta completa".
4. El GPS apagado al final del día se dibuja como corte hasta el cierre de la
   jornada (hoy la ruta simplemente termina).
5. No repetir "Reactivó el GPS" cuando dos reportes llegan casi juntos.

### Panel

1. En Inicio, marcar a quien nunca se conectó y a quien tiene la ubicación en
   "solo mientras se usa la app".
2. Marcar las velocidades reales altas como exceso de velocidad.
3. Medir el dibujo del mapa con rutas de 30 000 puntos en un equipo con
   tarjeta gráfica.

### App

1. Mandar marca y modelo del teléfono en el diagnóstico.
2. Notificación fija mientras el GPS esté apagado con la jornada abierta.
3. No iniciar jornada sin "Permitir todo el tiempo", o insistir hasta tenerlo.
4. Guía de ahorro de batería por marca en la pantalla de permisos (depende
   del punto 1).
5. Averiguar por qué el punto de quietud llega cada 4 a 6 min y no cada 2.
6. Revisar la lectura de batería: la de Martha no cambió en todo el día.
7. Aviso en el teléfono al perder el permiso de ubicación, no solo dentro de
   la app.
8. Consumo de batería en vehículo (GPS cada segundo): medirlo por modelo. No
   se reduce la cantidad de puntos sin decisión expresa.

### Con las personas, sin programar

- Joice: instalar la app e iniciar sesión.
- Sofía y Melina: ubicación en "Permitir todo el tiempo".
- Jefferson: no apagar la ubicación durante la jornada.
- Joselyn: inicio automático y batería sin restricciones en su teléfono.

## Versión 2.15 (código 414, lista el 12/11/2026)

Lista y firmada en `ota/DMujeres-Tracking-2.15.414.apk` (reemplaza a la 407 a 413);
todavía no se ofrece a ningún teléfono. Trae:

- APK de 3,1 MB (antes 9,8) y sin Analytics, Crashlytics ni reseña de Play.
- Aviso por marca cuando el sistema del teléfono cerró la app en jornada
  (`sistema/CierreDelSistema.kt`), con el ajuste exacto que hay que cambiar.
- En marcha, si Google deja de dar posición, pasa al GPS del teléfono a los
  20 s (antes 60 a 90 s). Ver [Cómo captura la app](app-captura.md).
- (408) Si el servidor da la sesión por terminada, lleva a entrar enseguida
  aunque queden puntos por enviar; antes esperaba la cola vacía y el teléfono
  quedaba trabado sin poder enviar (11/11). Lo guardado sube al volver a entrar.
- (409) Sin sesión, antes de pedir usuario y clave le pide al servidor la
  sesión de esa instalación (`POST /api/mobile/v1/sesion/recuperar`). Así los
  teléfonos que la 2.10 dejó sin sesión el 10 y 11/11 vuelven solos al
  actualizarse. Si la sesión se quitó desde el panel, pide entrar.
- (410) El acelerómetro entrega sus lecturas en tandas de 5 s: el teléfono
  despierta una vez por tanda y no cinco veces por segundo. El ZTE marcaba la
  app por "consumo del sensor" (2231 despertares en una hora quieta).
- (411) Si la persona quita la app de Recientes o usa "limpiar todo"
  (Xiaomi OneKeyClean, REMOVE TASK en Honor y Samsung), la supervisión se
  adelanta a 5 s para revivir el servicio, en vez de esperar hasta 3 min.
- (411) Tiempos de la captura desde el servidor, sin actualizar la app (ver
  "Ajustes de captura" en [Cómo captura la app](app-captura.md)).
- (412) "Siguiente actividad" sin tiempo mínimo: se puede pasar a la siguiente
  en el mismo minuto (la anterior queda de 0 minutos; el servidor ya acepta
  fin igual al inicio). Solo hay una pausa de 15 s entre una actividad nueva
  y otra, contra los toques seguidos.
- (413) Con `quietaBajoConsumo` (GPS apagado estando quieta), una lectura de
  wifi y antenas con más de 50 m de error ya no cuenta como salida: caía a
  100-300 m del sitio y encendía el GPS unas 8 veces por hora. La salida la
  avisan el sensor de movimiento y la cerca. Simulado con el mes de los 34
  equipos (7 386 h, 2 929 salidas): GPS encendido el 17 % de la jornada
  (antes 76 %), 0,25 encendidos falsos por hora de quietud (antes 7,9),
  ninguna salida perdida, aviso a los 34 s (38 s en el 90 %). Si el sensor de
  movimiento no avisa, solo queda la cerca: 266 salidas tardan más de 10 min.
  Con el GPS encendido en quietud (lo de hoy) no cambia nada.
- (414) Latido de quietud que se ajusta solo: cada 2 min los primeros 15 min
  en un sitio y cuando el último punto guardado fue malo (más de 50 m de
  error) y llega uno bueno; si no, cada 5 min. Con el mes: unos 2,6 puntos
  más por parada, 1,5 % más de puntos.
- (414) Desde el servidor, sin actualizar: latido (normal, corto y cuánto
  dura), tiempo para pasar a quieta, metros de salida, precisión que cuenta
  como salida con el GPS apagado y pausa entre actividades. Ver "Ajustes de
  captura" en [Cómo captura la app](app-captura.md).
- Ojo: no subir la 2.15 a GitHub como release si no es para todos. La app
  consulta GitHub cada vez que el servidor no le ofrece versión, así que un
  release ahí le llega a toda la flota.

Cómo se saca:

1. Instalarla por adb en el ZTE de prueba: arranque, jornada, cierre forzado
   y el aviso; comparar memoria (`dumpsys meminfo`) contra la 2.10.
2. Pilotos con `ota/por-equipo/<identificador>.json` (sin tocar
   `latest.json`). Conviene incluir a Nadia y Joselyn (Honor), que es donde
   más corta.
3. Para todos, cuando se dé la orden.

Lo que la 2.15 no puede arreglar: ninguna app vuelve a abrirse sola si el
sistema la detiene. Joselyn, Nadia, Silvia y Martha necesitan el ajuste de
inicio de apps en persona; Sofía y Jefferson apagan el GPS a mano; Jimmy,
Silvia y Estévez usan ubicación simulada. Medición en
[Calidad de la ruta](calidad-de-ruta.md).

## Otros pendientes

- Prueba de carga con toda la flota mandando puntos a la vez y cálculo del
  espacio en disco que ocupa cada mes de puntos.
- Un índice sobre `lower(identificador)` en la tabla de equipos, porque
  varias consultas buscan por ese campo sin distinguir mayúsculas.
- HTTPS con dominio propio para el panel (hay un ejemplo en
  `infraestructura/nginx/dmj-tracking-tls.example`).
- Instalar el plugin `docker compose` (versión 2) en el servidor; hoy solo
  está el `docker-compose` viejo, que no lee el archivo de la base.

## Actualización semanal de la app (17/10/2026)

Revisión de la semana del 12 al 16/10. Tres cambios en la app:

1. **No perder puntos sin red.** La cola sin conexión tiene un tope de 5 000
   puntos (`MAX_BUFFERED_POSITIONS` en `datos/DatabaseHelper.kt`); al pasarlo
   borra los más viejos. En vehículo con 10 m se guarda casi un punto por
   segundo, así que hora y media sin datos llena la cola. Nadia perdió unos
   2 400 puntos esta semana. Subir el tope a 50 000 (unos 10 MB).
2. **La distancia se aplica sin reiniciar.** `distanceMeters` y `angleDegrees`
   se leen una sola vez al arrancar el seguimiento (`seguimiento/PositionProvider.kt`).
   Hoy, después de cambiar la configuración de un equipo, hay que reiniciar la
   app o el teléfono. Leerlos de nuevo cuando llega la configuración.
3. **El diagnóstico muestra el intervalo real.** `cadence.movingMs` siempre
   dice 10 000 (`sistema/ServiceHeartbeat.kt` pasa `null`), así que desde el
   panel no se puede confirmar que la configuración llegó.

Configuración aplicada el 16/10 (se nota en cada equipo cuando reinicia la app):
25 m / 20 s en Nadia, Martha, Sonnia y Lizbeth; 25 m / 30 s en Base Cctv;
20 m en Norelys, Sofía y Diego. Israel, Jimmy y Joselyn siguen en 20 m / 20 s.
Revisar el lunes 19 si bajaron los puntos perdidos y los rebotes.

4. **Rescate que escala solo.** Hoy el servidor (`servidor/recuperacion`) manda
   un aviso invisible cuando un teléfono con jornada abierta deja de reportar,
   como mucho uno por minuto. Semana del 12/10: 1 204 avisos y 527
   confirmaciones; responden poco Nadia, Joselyn, Israel y David López (el
   sistema frena la app) y nada Melina (sin datos). Si tras 3 avisos seguidos
   no hay respuesta, mandar uno visible con sonido ("Abre la app de
   seguimiento") para que la persona la abra. Todo automático, sin botón en el
   panel. Necesita que la app muestre ese aviso y que el servidor lleve la
   cuenta de avisos sin respuesta.
