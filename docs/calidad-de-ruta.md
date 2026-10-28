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

Es una estimación, no una observación. Se acepta solo con estas condiciones,
que el servidor ya aplica:

- hueco de 5 min o menos;
- el camino por calles no más largo que 1,35 veces la recta (o +60 m);
- velocidad posible (130 km/h o menos);
- se dibuja punteado y con la palabra "estimado", nunca como línea sólida;
- no cuenta como prueba de dónde estuvo la persona.

Si se prefiere no mostrar nada estimado, se deja todo como corte naranja.
Hoy de 1323 huecos cortos manejando solo 195 se rellenan; del resto, 17 %
podría rellenarse (el servidor se queda sin tiempo), 40 % se descarta por
rodeo y 40 % porque los extremos del hueco son imprecisos.

## Qué falta, en orden de impacto

1. App: pasar a capturar seguido en cuanto Google diga "en vehículo" o
   "a pie". Hoy la actividad solo se anota en el punto; la salida se nota
   tarde (278 km).
2. App: la 2.10.1 deja más silencios en el Infinix de Jeremy (50 % y 36 % el
   26 y 27/10, contra 0 a 26 % con la 2.9.5). Revisar el cambio entre Google
   y el GPS directo (exige 10 lecturas buenas seguidas) antes de publicarla a
   la flota. 22 de 27 teléfonos siguen en 2.9.5.
3. Teléfonos que el sistema congela: ajustes de batería por marca (ver
   permisos-por-marca.md) y acelerómetro propio de la app para los que no
   tienen Google.
4. Servidor: más tiempo para rellenar por calles los huecos que sí tienen un
   camino posible.
