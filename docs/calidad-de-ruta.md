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

## Estado al 31/10/2026

La 2.10 (código 404) corre como piloto en los 10 equipos sin grupo; la flota
con grupo sigue en 403 hasta dar la orden de "para todos". Dos cambios
recientes atacan el retraso de subida: el reintento de la cola bajó su tope de
5 min a 1 min (404) y el push de recuperación despierta al teléfono a los
7 min de silencio en vez de 10.

Medición clave (20–31/10): el 88 % de los "silencios" en el panel es
grabó-y-subió-tarde (26 min de retraso medio), no ruta perdida. Solo el 12 %
es hueco real de captura. Es decir: el teléfono sí guarda la ruta; lo que
falla es que tarda en soltarla. Por eso en el panel un equipo "se ve muerto"
aunque esté trabajando.

## Qué falta, en orden de impacto

1. **Medir la fidelidad por jornada.** Hoy la calidad se adivina mirando el
   mapa. Calcular en el servidor, por jornada: % de tiempo cubierto, mediana
   de hueco, % de puntos con precisión < 15 m y minutos ciegos, y mostrarlo
   como puntaje en el panel. Sin número no se puede saber si un cambio mejora;
   con número, cada ajuste se prueba. Es el cimiento del resto.
2. **Diagnóstico por teléfono en el panel.** La app ya reporta casi todo
   (`EstadoTelefono.sistema`: ahorro, reposo, cubeta de standby, alarmas
   exactas, inicio automático, segundo plano restringido, salidas del
   sistema). Falta una señal (datos en segundo plano bloqueados / Data Saver,
   `getRestrictBackgroundStatus`) y, sobre todo, pintarlo en `Sistema.tsx`
   como una lista por equipo: "este teléfono, este interruptor". Es la única
   palanca real contra el congelado en teléfonos personales: no se fuerza,
   pero CCTV sabe exactamente qué corregir. Ataca el 12 % de pérdida y el
   retraso de subida.
3. **Latido de quietud a tiempo.** En jornada y quieta, el punto de control de
   5 min cae en ~6 min porque `PositionProvider` solo deja pasar una lectura
   cada 2 min (`AdaptiveCadence.STATIONARY_INTERVAL_MS`). Dejar pasar una
   lectura cada 1 min durante la jornada lo corrige. Más detalle con la
   persona parada en un local.
4. **Trazado pegado a la calle en el replay.** Usar el servicio `ruteo` como
   capa de visualización: dibujar la ruta siguiendo calles reales donde hay
   puntos que lo respaldan, sin descartar ni inventar (respeta la decisión del
   28/10). Un hueco de una cuadra se ve como la calle, no como raya recta.
5. **Subida garantizada en cortes largos.** Auditar que el búfer aguante los
   cortes de 26 min sin desbordar; subir el tope si hace falta.
6. **Cadencia que se autoajusta por equipo.** Ya hay config por equipo
   (`mobile.*`). Usar el consumo de batería y la fiabilidad medidos para que
   los teléfonos débiles vayan en ahorro y los fuertes en máxima fidelidad.
7. **Teléfonos que el sistema congela por marca** (ver permisos-por-marca.md)
   y acelerómetro propio para los que no tienen Google. El Huawei Android 9 de
   Silvia (hasta 60 % de lecturas malas) es caso de reemplazo, no de software.
