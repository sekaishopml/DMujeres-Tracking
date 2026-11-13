# Próximos cambios

Estado al 13/11/2026. Lo hecho queda al final, en una línea, para no
repetirlo.

## Versión 2.15 publicada para todos (13/11/2026)

Código 422, `ota/DMujeres-Tracking-2.15.422.apk`, en `latest.json` y en todos
los `ota/por-equipo/*.json`. Cada teléfono la recibe al abrir la app. Ya se
puede subir a GitHub como release (`scripts/publicar-en-github.sh 2.15`).

Queda por hacer:

1. Probar caminando y en carro con `quietaBajoConsumo` en el ZTE: si la
   salida llega a tiempo, activarlo para la flota (`ajustes_captura`).
2. Seguir en el panel a los que dicen "Sin iniciar sesión" (perdieron la
   sesión el 10 y 11/11 con la 2.10): al abrir la app se actualizan y la 2.15
   recupera la sesión sola. Si no, reinstalar en persona.

### Qué trae la 2.15

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
  fin igual al inicio). Solo hay una pausa de 3 s entre una actividad nueva
  y otra, contra los toques seguidos (416; antes 15 s).
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
- (415) Ubicación apagada o permiso quitado con la jornada abierta, de lunes a
  sábado de 07:00 a 17:00: el aviso suena cada 10 min mientras siga así y no
  se puede deslizar (antes, dos avisos y nada más; así pasó con Jefferson el
  10/11 y Sofía el 11/11). Los avisos de las 07:30, 08:15, 12:00 y 15:00
  llegan también el sábado (app y servidor).
- (419) Iniciar la jornada a mano desde las 09:00 (lunes a sábado, hasta las
  17:00) pide el motivo, igual que finalizar antes de las 17:00. Queda en la
  jornada (`notaInicio`) y en el cronograma del panel. Ajustable desde el
  servidor (`inicioConMotivoDesdeMin`). Desde la 2.10 hubo 17 inicios a mano
  a las 10:00 o más tarde (Jefferson, Kevin, Mariam, Miguel), sin cronograma.
- (421) Los cierres inesperados de la app llegan al servidor: se guardan y se
  envían al volver a abrirse (`lastDiagnostics.crash`). Antes se mandaba un
  texto vacío y en el momento en que el proceso moría, así que nunca llegaba.
- Ojo: la app consulta GitHub cada vez que el servidor no le ofrece versión,
  así que un release ahí le llega a toda la flota. Solo subir releases de
  versiones que son para todos.

## Pendientes

### Con las personas (no se arregla programando)

- Joselyn, Nadia, Silvia y Martha: ajuste de inicio de apps y batería sin
  restricciones, en persona. Ninguna app vuelve a abrirse sola si el sistema
  la detiene.
- Sofía y Jefferson apagan el GPS a mano (10 y 11/11). Desde la 2.15 el aviso
  suena cada 10 min en horario laboral y queda en la bitácora.
- Jimmy, Silvia y Estévez usan ubicación simulada (análisis de Jimmy abajo).
- Joice: nunca se conectó.

### Jimmy Llanllan (análisis del 13/11, nada de esto está probado ni aplicado)

Xiaomi 15 (HyperOS, Android 15). App 2.9.5 hasta el 5/11, 2.10 hasta el
13/11 a las 10:00 y 2.15 desde entonces. Datos del 20/10 al 13/11.

| Qué se ve | Dato |
|---|---|
| Puntos simulados | 1 376 de 33 623 (4 %), casi todos entre las 13:00 y las 17:00. El servidor los marca como no válidos y no se dibujan. |
| Días sin ruta | 30/10: 128 puntos y todos simulados, en una coordenada fija a 12 km de su zona (precisión 1 m, velocidad 0). 23/10 y 6/11: 3 h de corte. 10/11: 7,5 h de corte. |
| Silencios con la jornada abierta | 55 en 3 semanas, unas 60 h; 54 en horario laboral; mediana 16 min. |
| Reinicios del teléfono | 17 en 3 semanas (hoy a las 09:15). |
| GPS apagado | 14 avisos (5 a mano, mediana 89 min). El diagnóstico dice `gps_apagado` en 4 de cada 10 muestras: falta entender qué mide ese estado en Xiaomi, porque no cuadra con los 14 avisos. |

Hoy: a las 08:36 la app (2.10) dejó de recibir ubicación durante 35 min
(`gps_atrasado`, 871 s sin posición). A las 08:58 el servidor le mandó el
aviso visible «Abra la app de seguimiento» y a las 09:11 volvió a reportar:
primera vez que se ve el aviso funcionando. Desde las 10:00 con la 2.15: 0
puntos simulados y solo huecos de 6 a 8 min, que son el latido de quietud.
Es poco tiempo para decir que mejoró.

Mejoras posibles (en orden de lo que más ruta recuperaría):

1. **Ubicación simulada.** La app no puede ignorar una ubicación simulada que
   el sistema entrega. Se puede avisar a la persona con un texto formal
   («Su teléfono tiene la ubicación simulada activada. Desactívela para que
   se registre su recorrido. Dudas: departamento de CCTV») con el botón al
   ajuste de desarrollador, y marcarlo en Inicio y en el replay para que
   CCTV lo vea el mismo día. Requiere actualizar la app. Aplica a Jimmy,
   Silvia y Estévez.
2. **Aviso visible antes.** Hoy sale tras 3 rescates sin respuesta (a los 22
   min en su caso). Con 2 saldría a los 10 o 12 min. Es solo servidor, sin
   actualizar (`RESCATES_ANTES_DEL_AVISO` en `servidor/recuperacion/src/monitor.js`).
3. **Reinicios y silencios.** Medir con la 2.15 durante una semana: la 2.15 revive
   el servicio a los 5 s y avisa el ajuste de la marca. Si los 55 silencios
   siguen, revisar en persona el inicio de apps y el ahorro de batería de
   HyperOS.
4. **Entender `gps_apagado`.** Revisar en la app qué comprueba ese estado
   y cambiarlo para que solo diga «apagado» cuando lo esté.

### Servidor

- No usar la velocidad que reporta el teléfono si no se movió (quita los
  102 y 141 km/h falsos de Ariel y Joselyn). Revisar si la depuración del
  replay ya lo cubre.
- Un corte que empieza y termina en el mismo lugar: "detenida, sin puntos" y
  no "sin señal"; si después llegan los puntos atrasados, "sin cobertura,
  ruta completa".
- No repetir "Reactivó el GPS" cuando dos reportes llegan casi juntos.
- Índice sobre `lower(identificador)` en la tabla de equipos (no existe).
- Prueba de carga con toda la flota y espacio en disco por mes de puntos.

### Panel

- Inicio: marcar a quien nunca se conectó y a quien tiene la ubicación en
  "solo mientras se usa la app".
- Velocidades reales altas como exceso de velocidad.
- Medir el mapa con rutas de 30 000 puntos en un equipo con tarjeta gráfica.

### App

- Cortes con la app viva y sin posición (medido del 30/10 al 12/11, de 07:00
  a 17:00): 56 cortes y 48 h, casi todos de Silvia (Huawei, además ubicación
  simulada) y Joselyn (Honor, GPS sin respuesta con todo permitido). Es lo
  que más ruta quita; lo demás (app detenida 19 h, teléfono apagado 5 h, GPS
  apagado 5 h) es menor. Revisar en persona los ajustes de esos teléfonos.
- Batería: de 1 a 10 % por hora en horario laboral (Paola 10 %, Sofía 10 %,
  Estévez 9,5 %). Lo que más ahorra es `quietaBajoConsumo` para la flota,
  después de probarlo en la calle con el ZTE.
- Revisar la lectura de batería: la de Martha no cambió en todo un día.
- El diagnóstico manda `movingMs` fijo en 10 000; mandar el que se usa.
- Consumo en vehículo (GPS cada segundo) por modelo. No se reduce la
  cantidad de puntos sin decisión expresa.

### Decide el usuario

- Seguridad del servidor: fail2ban y entrada por SSH solo con llave.
- Quitar la clave móvil compartida.
- Respaldos de la base fuera del servidor.
- HTTPS con dominio propio (ejemplo en
  `infraestructura/nginx/dmj-tracking-tls.example`).
- Plugin `docker compose` versión 2 (hoy solo está el `docker-compose` viejo,
  que no lee el archivo de la base).

## Hecho

- Identificador `com.dmujeres.tracking` en toda la flota, firma 86:7B:A1:29.
  No volver a cambiarlo: una app con otro identificador no se actualiza, hay
  que desinstalar e instalar en cada teléfono.
- Cola sin conexión de 100 000 puntos (`MAX_BUFFERED_POSITIONS`).
- Marca y modelo en el diagnóstico; no se inicia jornada sin "Permitir todo
  el tiempo"; aviso al perder el permiso o apagar la ubicación (2.10, se
  repite en la 2.15).
- Motivo obligatorio para cerrar entre 07:00 y 17:00 (2.10.10). Los cierres
  sin motivo del mes fueron todos de antes de esa versión.
- Punto de quietud: era cada 4 a 6 min; desde la 2.15, 2 min al llegar y
  5 min después, ajustable desde el servidor.
- La distancia y los tiempos de captura se aplican sin reiniciar la app
  (ajustes desde el servidor, 2.15).
- El GPS apagado al final del día se dibuja como corte hasta el cierre de la
  jornada, con la causa (replay).
- Rescate que escala solo (13/11): tras 3 avisos invisibles sin respuesta, el
  servidor manda uno visible con sonido ("Abra la app de seguimiento"), de
  lunes a sábado de 07:00 a 17:00, cada 3 más y hasta 6 por silencio. Lo
  muestra el sistema del teléfono, así que sirve también con la 2.10. Queda
  en la bitácora.
- Excel de Marketing: solo encendido (inicio manual de la jornada, o primer
  contacto desde las 0:00 si seguía abierta) y apagado (fin manual, o último
  punto), ver [Servidor](servidor.md).
- Revisión de rutas del 13/10 y semanal del 17/10: lo que quedaba está arriba
  en Pendientes.
