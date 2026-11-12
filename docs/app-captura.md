# Cómo captura la app

Guía técnica de la captura de ubicación en la app Android: qué decide cada
pieza y dónde cambiarla. Lo general (compilar, publicar, carpetas) está en
[La app Android](app-android.md).

Todo pasa por `seguimiento/TrackingController.kt`: es el único que manda en
la captura, la máquina de movimiento, la cola y la recuperación. Las reglas
están en clases sin Android (se prueban en `app/src/test`).

## De dónde salen las posiciones

**Escalera de proveedores** (`seguimiento/EscaleraProveedores.kt`):

1. Google (ubicación fusionada: satélites + wifi + antenas + sensores). Solo
   en la variante `google`.
2. GPS del teléfono (solo satélites; no responde bajo techo).
3. Red (wifi y antenas; responde bajo techo, 50 a 2000 m de error).

Si el vigente calla (`LocationWatchdog`: 20 s en movimiento, revisando cada
10 s, desde la 2.15; 2 min quieta),
primero se le vuelve a pedir y después se baja un escalón. En marcha no se
baja a red ni se pide el rescate por red (desde la 2.10.3): se alterna entre
Google y el GPS, y si arrancó con la red de bajo techo vuelve a Google. A los
10 min en un escalón de respaldo se vuelve a Google, pero nunca a mitad de un
viaje.

**GPS en paralelo** (`seguimiento/GpsTibio.kt`): en movimiento con Google,
el GPS del teléfono queda encendido aparte. Cuando ya es estable (10 lecturas
seguidas coherentes de 20 m o mejor, `captura/GpsEstable.kt`):

- si Google lleva 3 s sin una posición buena, se guardan las del GPS (desde
  la 2.10.2);
- si lleva 20 s, se cambia de proveedor al GPS.

**Rescate por red** (`RescateRed.kt`): mientras el vigente calla y la persona
no va en marcha, se pide una ubicación por red en paralelo para no quedar en
blanco.

## Cada cuánto (`seguimiento/AdaptiveCadence.kt`)

Con jornada: GPS en alta precisión cada 1 s; quieta, cada 10 s. Lo que se
guarda lo filtra `PositionProvider` (distancia, giro y latido): en movimiento
un latido cada 10 s (la "Frecuencia" del panel, 10 a 60 s) más cada esquina;
quieta, el latido es de 2 min pero el temblor no se guarda (ver abajo). Sin
jornada: red cada 2 min.

## ¿Se mueve? (`movimiento/MovementStateMachine.kt`)

Estados: STARTING, ACTIVE, STATIONARY, RECOVERING, STOPPED. Señales, de más
a menos importante:

1. GPS: alejarse 80 m del centro del sitio (o 30 m con 3 nudos), dos puntos
   seguidos del mismo lado.
2. Caminata sostenida 3 min (`captura/WalkDetector.kt`).
3. Desplazamiento acumulado de 150 m.
4. Movimiento significativo (sensor de bajo consumo) y, desde la 2.10.2, la
   actividad de Google "en vehículo / bicicleta / a pie" con 70 % de
   confianza (`ReconocimientoActividad.kt` → `MotionMonitor.avisarMovimiento`).
5. Acelerómetro (`MotionMonitor.kt`): 20 s seguidos de movimiento avisan el
   arranque (`ArranqueSostenido.kt`, desde la 2.10.10), con 2 min de espera
   entre avisos. Cubre los teléfonos sin actividad de Google. El sensor de
   movimiento significativo (el único que despierta al teléfono dormido) se
   usa en todas las versiones de Android; antes solo desde la 14.

Para pasar a STATIONARY hacen falta 3 min seguidos de quietud. Sin puntos
4 min se pasa a RECOVERING.

## Qué se guarda (`captura/`)

En este orden, para cada posición:

1. `TeleportGuard`: descarta saltos imposibles contra el último punto
   aceptado de menos de 60 s: más de 200 km/h; velocidad 0 con avance de
   más de 15 km/h; o rebote (en 30 s, más de 30 m a más del triple de la
   velocidad reportada +15 km/h). Si el salto cabe en el error de los dos
   puntos se acepta.
2. `CaptureGate` + `StationaryCollapse`: quieta solo guarda si avanzó más
   que el doble del error de las lecturas (15 a 100 m; bajo techo el punto
   "camina" 25 a 80 m) o pasaron 5 min; una lectura de más de 100 m de error
   nunca cuenta como avance. El latido de 5 min se guarda tal cual, pero si es
   peor no mueve la referencia: el avance se mide desde el mejor punto del
   lugar (desde la 2.10.9). En una esquina guarda aunque no toque
   (`TurnCapture`).
3. `DuplicateFixGuard`: no guarda dos veces el mismo punto.

Cada punto lleva precisión, velocidad, batería, actividad y pasos
(`ActividadFisica.kt`, `Pasos.kt`).

## Envío (`envio/`, `red/`)

`UploadQueue.kt`: lotes de hasta 50, reintento de 5 s a 5 min. Con poca
batería (15 % o menos) sube cada minuto (`UploadThrottle.kt`). Cada punto
lleva el arranque de la app y un número de secuencia: reenviar no duplica.

## Que no se muera

- Servicio en primer plano mientras hay jornada.
- `recuperacion/DozeAlarmReceiver.kt`: alarma exacta cada 3 min que revisa
  el GPS y la cola.
- Push de recuperación desde el servidor si deja de reportar.
- `sistema/VigiliaGps.kt`: mantiene el procesador despierto solo mientras
  faltan posiciones.
- `sistema/OemAutostart.kt` y [Permisos por marca](permisos-por-marca.md):
  ajustes de Huawei, Honor, Xiaomi, Infinix, etc.
- `sistema/ServiceHeartbeat.kt`: diagnóstico cada 10 min (se ve en Salud).

## Dónde cambiar qué

| Quiero cambiar… | Archivo |
|---|---|
| Cada cuánto se pide y guarda | `seguimiento/AdaptiveCadence.kt`, `PositionProvider.kt` |
| Cuándo se considera que salió o se detuvo | `movimiento/MovementStateMachine.kt` |
| Qué saltos se descartan en el teléfono | `captura/TeleportGuard.kt` |
| Qué se guarda estando quieta | `captura/StationaryCollapse.kt`, `CaptureGate.kt` |
| Cambio de proveedor y GPS en paralelo | `seguimiento/TrackingController.kt` (`revisar`, `revisarTibio`), `EscaleraProveedores.kt`, `GpsTibio.kt` |
| Subida al servidor | `envio/UploadQueue.kt`, `red/` |

## Ajustes de captura desde el servidor (desde la 2.15)

Los tiempos que más pesan en la batería y en los cortes llegan del servidor
en `ajustes` de `/api/mobile/v1/config` (`datos/Ajustes.kt`). Primero los de
toda la flota (`system.dmt_configuracion`, clave `ajustes_captura`) y encima
los del equipo (atributo `mobile.ajustes`). Si cambian, la app reinicia la
captura. Ausente o fuera de rango, vale el de fábrica.

| Ajuste | Fábrica | Rango | Qué hace |
|---|---|---|---|
| `gpsMarchaMs` | 1000 | 1000–10000 | Cada cuánto se pide posición en marcha |
| `gpsQuietaMs` | 10000 | 1000–120000 | Cada cuánto se pide posición quieta |
| `quietaBajoConsumo` | 0 | 0–1 | 1 = quieta con wifi y antenas, sin GPS |
| `sinFixMarchaMs` | 20000 | 5000–120000 | Sin posición en marcha: cambia de proveedor |
| `sinFixQuietaMs` | 120000 | 30000–900000 | Sin posición quieta: vuelve a pedir |
| `googleSinFixBuenoMs` | 20000 | 3000–120000 | Google sin posición buena: pasa al GPS |
| `huecoGoogleMs` | 3000 | 1000–30000 | Google calla: guarda las del GPS en paralelo |
| `supervisionMs` | 180000 | 60000–900000 | Alarma que revisa y revive el servicio |
| `tandaAcelerometroMs` | 5000 | 0–30000 | Tandas del acelerómetro |

Ejemplo, solo para un equipo:
`UPDATE tracking.dmt_dispositivo SET atributos = jsonb_set(atributos, '{mobile.ajustes}', '{"gpsQuietaMs":30000}') WHERE identificador = 'Santi-ZTE';`

## Qué falta mejorar

- Medir en la calle la 2.10.2 (GPS en paralelo a los 3 s y arranque por
  actividad) antes de pasarla a toda la flota; con la 2.10.1 Jeremy tenía más
  cortes que con la 2.9.5.
- iPhone: no hay actividad ni acelerómetro propio de la app.
- Teléfonos que el sistema congela (Huawei, Honor, Xiaomi, Infinix): siguen
  siendo la causa de los silencios de más de 2 min.
- Rechazar puntos con la hora del teléfono muy desfasada.
