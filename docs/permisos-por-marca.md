# Permisos y ajustes por marca de teléfono

Cada fabricante agrega su propio ahorro de energía encima de Android. Si no se
configura, el teléfono detiene la app con la pantalla apagada y la ruta sale con
cortes, aunque los permisos de Android estén bien.

La pantalla **Permisos** de la app detecta la marca y muestra solo lo que ese
teléfono necesita. Cada fila tiene un botón **Abrir** que lleva a la pantalla
exacta del ajuste. Si esa versión del sistema no la tiene, abre la ficha de la
app, donde están los mismos interruptores.

## Para todos los teléfonos (obligatorio)

| Ajuste | Qué elegir | La app lo comprueba |
|---|---|---|
| Ubicación | Permitir | Sí |
| Ubicación siempre | "Permitir todo el tiempo" y ubicación precisa | Sí |
| Notificaciones | Encendidas | Sí |
| Batería sin restricción | Sin optimizar y **no** en "Restringida" | Sí |
| Ahorro de batería del teléfono | Apagado durante la jornada | Sí (aviso en rojo en la pantalla principal) |
| Alarmas y recordatorios (solo Android 12) | Permitir | Sí (la fila sale solo si falta) |

Con el ahorro de batería encendido, Android puede dejar de dar ubicación a las
apps en segundo plano. El diagnóstico lo envía como `ubicacionEnAhorro`.

## Xiaomi, Redmi y POCO (MIUI / HyperOS)

Es la marca más común de la flota y la más agresiva. HyperOS congela las apps
pocos segundos después de apagar la pantalla, aunque tengan la notificación fija.
Lo único que lo evita es el ahorro de batería de Xiaomi en "Sin restricciones".
El permiso de batería de Android no alcanza.

1. **Inicio automático:** activado. La app lo comprueba y lo envía en el diagnóstico (`inicioAutomatico`).
2. **Ahorro de batería de Xiaomi:** "Sin restricciones". La app intenta comprobarlo (`sinRestriccionXiaomi`). Si el sistema no lo deja leer, la fila queda sin visto.
3. **Recomendado:** en Recientes, bloquear la app con el candado.

Las actualizaciones del sistema suelen apagar el inicio automático: hay que revisarlo después de cada actualización.

## Huawei y Honor (EMUI / MagicOS)

El sistema cierra las apps que considera de "alto consumo" y puede dejar el GPS
sin dar ubicaciones aunque la app siga viva.

1. **Inicio de apps:** buscar la app, desactivar "Gestionar automáticamente" y dejar encendidas las tres opciones (inicio automático, inicio secundario y ejecutar en segundo plano).
2. **Recomendado:** en Batería, desactivar el ahorro y "Optimización inteligente" (Smart tune-up), si existe.

Honor nuevo usa otra aplicación de sistema que Huawei; la app prueba las dos.

## Samsung (One UI)

Samsung pone en suspensión las apps que no se abren en unos 3 días y las
suspende del todo a los 16 días.

1. **Nunca suspender:** agregar la app a "Apps que nunca se suspenden" (Batería > Límites de uso en segundo plano). El botón usa el enlace que publica Samsung.

## Infinix, Tecno e itel (XOS / HiOS)

"Phone Master" manda por encima de los ajustes de batería de Android.

1. **Inicio automático (Phone Master):** permitir el inicio automático y la actividad en segundo plano.
2. **Recomendado:** en Batería, desactivar "Administración de ahorro de energía de apps" para la app.

## ZTE (MyOS)

ZTE protege su pantalla de ahorro con un permiso propio: la app no puede
abrirla. Se configura a mano:

1. Ajustes > Batería > Gestión inteligente > buscar la app.
2. Autoinicio, Inicio relacionado y Ejecución en segundo plano: **Permitir** (vienen en "Automático").

## Motorola y otros

Funcionan con los ajustes generales. Si el fabricante tiene una pantalla de
inicio automático conocida, la app muestra también esa fila.

## Cómo saber si un teléfono está bien configurado

El diagnóstico que llega cada 10 minutos trae, en el bloque `sistema`:

- `fabricante`, `rom`: marca y versión del sistema del fabricante.
- `inicioAutomatico`, `sinRestriccionXiaomi`: solo en Xiaomi.
- `segundoPlanoRestringido`: batería de la app en "Restringida".
- `ubicacionEnAhorro`: 0 normal; otro valor = el ahorro corta la ubicación.
- `ultimaSalida`: por qué el sistema cerró la app la última vez.
- `reiniciosPorAlarma`: cuántas veces la app tuvo que levantarse sola.

## Aviso en la pantalla principal (desde 2.15)

Además de los permisos, la franja roja de arriba pide el ajuste de la marca
(`pantallas/MainActivity.kt`, `avisosPendientes`):

- Xiaomi: "Inicio automático" y "Sin restricciones", porque se pueden leer;
  se ponen en verde al arreglarlos.
- Las demás marcas no dejan leer el ajuste. Se pide solo cuando el teléfono
  cerró la app durante la jornada y tardó más de 4 min en volver
  (`sistema/CierreDelSistema.kt`): la alarma de supervisión la levanta en 3,
  así que más que eso es que el teléfono no la dejó. Al tocarlo abre la
  pantalla de la marca y no se repite hasta otro cierre. Un cierre que vuelve
  en segundos (Xiaomi con inicio automático) no se avisa.

En la flota (29/10 al 05/11): Honor con "Inicio de apps" en automático
detiene la app por su cuenta (`PowerGenie smartopt clean`, Joselyn) y
entonces ni la alarma ni el aviso push la reviven (le llegaron 24 de 894
avisos); el Honor de joseph, bien configurado, vuelve en segundos.

## Lo que ninguna app puede hacer

- Activar estos ajustes por su cuenta: el fabricante solo deja que la persona los cambie.
- Seguir funcionando si alguien toca "Forzar detención": la app queda quieta hasta que se abra de nuevo.
- Evitar que una actualización del sistema reinicie estos ajustes.

Por eso la configuración se hace en persona al entregar el teléfono y se revisa
después de cada actualización del sistema.
