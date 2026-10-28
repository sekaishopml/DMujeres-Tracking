# Calidad de la ruta: qué la corta y qué falta

Medición sobre 315 días-equipo (10/10 al 27/10/2026, unos 920 000 puntos).

## Lo que ya está bien

Cuando el teléfono manda puntos en movimiento, la captura es buena:

- 97 % de los puntos llega cada 5 s o menos.
- 93 % tiene 10 m de precisión o mejor.
- 91 % de lo dibujado es línea sólida; 9 % (1166 km) es raya naranja de corte.

El problema no es la calidad de los puntos: son los ratos en que no llega
ninguno. Ni el servidor ni el panel pueden inventar lo que el teléfono no mandó.

## De dónde salen los cortes

| Causa | Veces | km | Quiénes más | Dónde se arregla |
|---|---|---|---|---|
| El GPS calla 15 a 120 s a mitad de un viaje | 985 | 454 | Sonnia, David, Sofía, Jeremy, iPhone | App / teléfono |
| La app deja de capturar más de 2 min en movimiento | 279 | 383 | Israel, Joselyn, Silvia | App / ahorro de batería |
| Arranca desde quieto y la app tarda en notarlo | 196 | 278 | Jimmy, Joselyn, Israel, Silvia | App |
| Sin contacto con el servidor | 30 | 133 | Joselyn, Israel | Teléfono / red |
| GPS apagado por la persona | 11 | 29 | Jimmy | Persona |

Depende mucho del teléfono: Joseph (Honor) pierde 0 % todos los días; Silvia
(Huawei sin Google) 78 %, Jimmy (Xiaomi) 49 %, Joselyn (Honor) 48 %.

## ¿Se puede capturar con internet, satélite y GPS a la vez?

Ya se hace.

- "Satélite" y "GPS" son lo mismo: el teléfono usa a la vez los satélites GPS,
  GLONASS, Galileo y BeiDou. Es la única fuente precisa (2 a 10 m).
- "Internet" es la ubicación por wifi y antenas: 50 a 2000 m de error. Sirve
  para saber en qué zona está, no para dibujar por qué calle fue.
- La app pide la ubicación de Google en alta precisión, que junta satélites,
  wifi, antenas y los sensores del teléfono. Desde la 2.10.1 además tiene el
  GPS del teléfono encendido en paralelo por si Google calla.

Por qué igual hay cortes:

1. Sin cielo no hay satélites: túneles, pasos a desnivel, edificios, centros
   comerciales. Lo único que queda es wifi/antena, demasiado impreciso para
   una ruta que se audita (por eso esos puntos se quitan o se marcan).
2. Si el sistema del teléfono congela la app (ahorro de batería de Huawei,
   Honor, Xiaomi, Infinix), no llega ninguna fuente. Es la causa de los
   silencios de más de 2 min.
3. Teléfono apagado, sin batería o GPS apagado por la persona.

Una ruta 100 % sin cortes y 100 % verídica no existe en ningún sistema: donde
no hubo señal solo se puede decir "no se vio" o estimar.

## ¿Rellenar por calles es inventar?

Sí: es una estimación, no una observación. Decisión del 28/10: **no se
rellena**. Cada novedad del recorrido se audita, así que un hueco sin puntos
queda como corte naranja recto (lo que no se vio). El ajuste a calles solo se
hace donde hay puntos reales que lo respaldan (MATCHED). Antes se rellenaban
unos 195 huecos cortos con un camino probable punteado; ya no.

## Qué falta, en orden de impacto

1. App 2.10.3 (en prueba en los 10 equipos sin grupo desde el 27/10): pasa a
   capturar seguido en cuanto Google dice "en vehículo" o "a pie"; usa el GPS
   del teléfono si Google calla 3 s; en marcha no baja a ubicación por red
   (era lo que empeoró a Jeremy con la 2.10.1). Medir sus cortes antes de
   pasarla a la flota (22 de 27 teléfonos siguen en 2.9.5).
2. Teléfonos que el sistema congela: ajustes de batería por marca (ver
   permisos-por-marca.md) y acelerómetro propio de la app para los que no
   tienen Google.
