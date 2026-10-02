# Curso corto de SQL para la consola de Sistema

Este curso enseña lo necesario para consultar la base de DMujeres Tracking desde la consola del panel (**Sistema → Consola**). No hace falta saber programar.

> **Tranquilidad primero:** la consola es de **solo lectura**. Ninguna consulta puede borrar, cambiar ni agregar datos. Si te equivocas, solo verás un mensaje de error. Además, las cuentas y contraseñas no se pueden ver desde aquí.

---

## Lección 0 · Cómo se escribe en la consola

En la consola hay dos tipos de órdenes:

1. **Comandos listos** (sin SQL). Escribe `ayuda` para ver todos. Por ejemplo:
   ```
   resumen
   equipos
   posicion maria
   bateria maria 20
   ```
2. **Consultas SQL**: se escriben con la palabra `sql` delante.
   ```
   sql select nombre from tracking.dmt_dispositivo
   ```

Trucos:
- **Enter** ejecuta.
- **↑ y ↓** recuperan las órdenes que ya escribiste.
- `limpiar` borra la pantalla.
- Se muestran como máximo **200 filas**, y una consulta puede tardar como máximo **5 segundos**.

---

## Lección 1 · ¿Qué es una tabla?

Una base de datos guarda la información en **tablas**, como hojas de Excel:

- cada **fila** es un registro (por ejemplo, un punto GPS);
- cada **columna** es un dato de ese registro (la hora, la latitud, la batería…).

Estas son las tablas que más vas a usar:

| Tabla | Qué guarda | Columnas útiles |
|---|---|---|
| `tracking.dmt_dispositivo` | Cada teléfono o persona | `id`, `nombre`, `identificador`, `habilitado`, `ultima_conexion_en`, `atributos` |
| `tracking.dmt_posicion` | **Todos** los puntos GPS que llegaron | `dispositivo_id`, `registrado_en` (hora en que se capturó), `recibido_en` (hora en que llegó al servidor), `latitud`, `longitud`, `precision_m`, `velocidad_kmh`, `bateria_pct` |
| `tracking.dmt_posicion_actual` | Solo el **último** punto de cada teléfono | las mismas que la anterior |
| `operations.dmt_jornada` | Jornadas de trabajo | `dispositivo_id`, `inicio_en`, `fin_en`, `estado` (`abierta` o `cerrada`) |
| `tracking.dmt_evento` | Cosas que pasaron: inicio o fin de jornada, GPS apagado, teléfono encendido… | `dispositivo_id`, `tipo`, `ocurrido_en` |
| `operations.dmt_actividad` | Cronograma de actividades | `dispositivo_id`, `fecha`, `hora`, `hora_fin`, `tipo`, `lugar`, `nota` |

El nombre completo de una tabla es `esquema.tabla`: `tracking` es la carpeta y `dmt_posicion` la hoja. El comando `tablas` muestra la lista completa.

**El dato clave:** las tablas se conectan por el `id` del teléfono. En `dmt_dispositivo` se llama `id`, y en las demás tablas se llama `dispositivo_id`.

---

## Lección 2 · SELECT: pedir datos

La forma básica de cualquier consulta es:

```
select <columnas> from <tabla>
```

Ejemplos:

```
sql select nombre, identificador from tracking.dmt_dispositivo
```
Muestra el nombre y el identificador de todos los teléfonos.

```
sql select * from tracking.dmt_dispositivo limit 5
```
- `*` significa "todas las columnas".
- `limit 5` muestra solo 5 filas. Úsalo siempre que explores una tabla grande.

> No importa si escribes en mayúsculas o minúsculas: `SELECT` y `select` funcionan igual.

---

## Lección 3 · WHERE: filtrar

`where` deja pasar solo las filas que cumplen una condición.

```
sql select nombre, ultima_conexion_en from tracking.dmt_dispositivo where habilitado = true
```

Comparaciones disponibles:

| Escribes | Significa |
|---|---|
| `=` | igual |
| `<>` | distinto |
| `>`  `<`  `>=`  `<=` | mayor, menor… |
| `ilike '%mari%'` | contiene "mari", sin importar mayúsculas. El `%` significa "cualquier cosa" |
| `is null` | el dato está vacío |
| `is not null` | el dato tiene valor |

Para combinar condiciones se usa `and` (las dos deben cumplirse) u `or` (basta con una):

```
sql select nombre from tracking.dmt_dispositivo where nombre ilike '%a%' and habilitado = true
```

> **Texto entre comillas simples:** `'maria'`. Los números van sin comillas: `bateria_pct < 20`.

---

## Lección 4 · ORDER BY: ordenar

```
sql select nombre, ultima_conexion_en from tracking.dmt_dispositivo order by ultima_conexion_en desc
```
- `desc` ordena de mayor a menor (lo más reciente primero).
- `asc` ordena de menor a mayor. Es lo que se usa si no escribes nada.

El orden correcto de las partes es siempre el mismo:

```
select … from … where … order by … limit …
```

---

## Lección 5 · Horas y fechas

Las horas se guardan en hora universal (UTC). Para verlas en **hora de Ecuador** se agrega `at time zone 'America/Guayaquil'`:

```
sql select nombre, ultima_conexion_en at time zone 'America/Guayaquil' as ultima from tracking.dmt_dispositivo
```
`as ultima` le pone un nombre más corto a la columna.

Para buscar por tiempo:

| Quieres | Escribes |
|---|---|
| Ahora mismo | `now()` |
| Última hora | `registrado_en > now() - interval '1 hour'` |
| Últimos 30 minutos | `registrado_en > now() - interval '30 minutes'` |
| Últimos 2 días | `registrado_en > now() - interval '2 days'` |
| Desde una fecha y hora | `registrado_en >= '2026-10-01 08:00-05'` |

El `-05` del final indica la hora de Ecuador.

Ejemplo: los puntos de la última hora.

```
sql select dispositivo_id, registrado_en at time zone 'America/Guayaquil' as hora, latitud, longitud from tracking.dmt_posicion where registrado_en > now() - interval '1 hour' order by registrado_en desc limit 50
```

> **Importante:** `dmt_posicion` tiene muchísimas filas. Pon siempre un filtro de tiempo (`registrado_en > …`) para que la consulta sea rápida y no pase de los 5 segundos.

---

## Lección 6 · Contar y agrupar

Funciones para resumir:

| Función | Qué hace |
|---|---|
| `count(*)` | cuenta filas |
| `max(x)`  `min(x)` | el mayor o el menor |
| `avg(x)` | promedio |
| `round(x, 1)` | redondea a 1 decimal |

¿Cuántos puntos llegaron en la última hora?
```
sql select count(*) from tracking.dmt_posicion where registrado_en > now() - interval '1 hour'
```

`group by` cuenta **por grupo**, por ejemplo por teléfono:
```
sql select dispositivo_id, count(*) as puntos from tracking.dmt_posicion where registrado_en > now() - interval '1 hour' group by dispositivo_id order by puntos desc
```

> **Regla:** toda columna del `select` que no esté dentro de `count`, `max`, `avg`… tiene que estar en el `group by`.

---

## Lección 7 · JOIN: unir tablas para ver nombres

En la lección anterior aparece `dispositivo_id` (un número), no el nombre de la persona. Para ver el nombre se **une** con la tabla de teléfonos:

```
sql select d.nombre, count(*) as puntos
from tracking.dmt_posicion p
join tracking.dmt_dispositivo d on d.id = p.dispositivo_id
where p.registrado_en > now() - interval '1 hour'
group by d.nombre
order by puntos desc
```

Cómo leerlo:
- `tracking.dmt_posicion p`: la tabla de puntos, con el apodo **p**.
- `join tracking.dmt_dispositivo d`: se une con la de teléfonos, con el apodo **d**.
- `on d.id = p.dispositivo_id`: así se conectan las dos tablas.
- Después se usan los apodos: `d.nombre`, `p.registrado_en`.

> En la consola puedes escribir todo en una sola línea. Aquí está en varias solo para que se lea mejor.

---

## Lección 8 · La columna `atributos`

Algunas tablas tienen una columna `atributos` con datos extra en formato JSON. Para sacar un dato se usa `->>` con su nombre entre comillas:

```
sql select nombre, atributos->>'mobile.appVersion' as version_app, atributos->>'plataforma' as plataforma from tracking.dmt_dispositivo
```

Nombres útiles dentro de `atributos` de `dmt_dispositivo`:
- `mobile.appVersion`: versión de la app.
- `mobile.pending`: puntos por enviar.
- `plataforma`: `ios` en los iPhone; vacío en Android.

---

## Lección 9 · Recetas listas para copiar

**1. Última posición de cada persona, con coordenadas**
```
sql select d.nombre, pa.registrado_en at time zone 'America/Guayaquil' as hora, pa.latitud, pa.longitud, pa.precision_m, pa.bateria_pct from tracking.dmt_posicion_actual pa join tracking.dmt_dispositivo d on d.id = pa.dispositivo_id order by pa.registrado_en desc
```

**2. Personas que no reportan hace más de 30 minutos**
```
sql select nombre, ultima_conexion_en at time zone 'America/Guayaquil' as ultima from tracking.dmt_dispositivo where habilitado and ultima_conexion_en < now() - interval '30 minutes' order by ultima_conexion_en
```

**3. Batería baja (menos de 20 %) ahora**
```
sql select d.nombre, pa.bateria_pct from tracking.dmt_posicion_actual pa join tracking.dmt_dispositivo d on d.id = pa.dispositivo_id where pa.bateria_pct < 20 order by pa.bateria_pct
```

**4. Cómo bajó la batería de una persona hoy**
```
sql select p.registrado_en at time zone 'America/Guayaquil' as hora, p.bateria_pct from tracking.dmt_posicion p join tracking.dmt_dispositivo d on d.id = p.dispositivo_id where d.nombre ilike '%maria%' and p.registrado_en > now() - interval '12 hours' order by p.registrado_en desc limit 100
```

**5. Jornadas abiertas y desde cuándo**
```
sql select d.nombre, j.inicio_en at time zone 'America/Guayaquil' as desde from operations.dmt_jornada j join tracking.dmt_dispositivo d on d.id = j.dispositivo_id where j.estado = 'abierta' order by j.inicio_en
```

**6. Jornadas de ayer con sus horas trabajadas**
```
sql select d.nombre, j.inicio_en at time zone 'America/Guayaquil' as inicio, j.fin_en at time zone 'America/Guayaquil' as fin, round(j.duracion_s / 3600.0, 2) as horas from operations.dmt_jornada j join tracking.dmt_dispositivo d on d.id = j.dispositivo_id where j.inicio_en > now() - interval '2 days' order by j.inicio_en
```

**7. Eventos de hoy de una persona (inicio y fin de jornada, GPS, encendido)**
```
sql select e.ocurrido_en at time zone 'America/Guayaquil' as hora, e.tipo from tracking.dmt_evento e join tracking.dmt_dispositivo d on d.id = e.dispositivo_id where d.nombre ilike '%maria%' and e.ocurrido_en > now() - interval '1 day' order by e.ocurrido_en desc
```

Tipos de evento frecuentes:
- `mobileJourneyStarted` / `mobileJourneyEnded`: inicio y fin de jornada.
- `mobileGpsDisabled` / `mobileGpsReenabled`: GPS apagado y vuelto a encender.
- `mobilePowerOn`: teléfono encendido.
- `mobileNetworkLost` / `mobileNetworkRestored`: perdió y recuperó internet.
- `mobileBatteryCritical`: batería crítica.

**8. Actividades declaradas hoy**
```
sql select d.nombre, a.hora, a.hora_fin, a.tipo, a.lugar from operations.dmt_actividad a join tracking.dmt_dispositivo d on d.id = a.dispositivo_id where a.fecha = current_date and not a.eliminada order by d.nombre, a.hora
```

**9. Retraso de llegada de los puntos (captura contra llegada al servidor)**
```
sql select d.nombre, round(avg(extract(epoch from (p.recibido_en - p.registrado_en)))) as segundos_promedio from tracking.dmt_posicion p join tracking.dmt_dispositivo d on d.id = p.dispositivo_id where p.registrado_en > now() - interval '1 hour' group by d.nombre order by segundos_promedio desc
```
Si sale un número alto, ese teléfono guardó los puntos sin internet y los envió después.

**10. Puntos con mala precisión (más de 50 m) en la última hora**
```
sql select d.nombre, count(*) as puntos_malos from tracking.dmt_posicion p join tracking.dmt_dispositivo d on d.id = p.dispositivo_id where p.registrado_en > now() - interval '1 hour' and p.precision_m > 50 group by d.nombre order by puntos_malos desc
```

---

## Lección 10 · Errores comunes

| Mensaje | Qué pasó | Solución |
|---|---|---|
| `column "xxx" does not exist` | La columna está mal escrita | Revisa la tabla de la lección 1 o mira con `limit 1` |
| `relation "xxx" does not exist` | Falta el esquema o el nombre está mal | Escribe `tracking.dmt_posicion`, no solo `dmt_posicion` |
| `permission denied` | Intentaste ver algo protegido (cuentas, auditoría) | Es a propósito: esa información no se ve desde la consola |
| `canceling statement due to statement timeout` | La consulta tardó más de 5 s | Agrega un filtro de tiempo (`registrado_en > now() - interval '1 hour'`) |
| `syntax error at or near …` | Falta una coma, una comilla o el orden está mal | Recuerda: `select … from … where … group by … order by … limit …` |
| `must appear in the GROUP BY clause` | Usaste `group by` y quedó una columna afuera | Agrégala al `group by` o métela en `count`, `max`… |
| `sql solo admite consultas de lectura` | Escribiste algo que no empieza con `select` o `with` | En la consola solo se consulta, no se modifica |

---

## Lección 11 · Ejercicios

Intenta resolverlos tú primero. Las soluciones están más abajo.

1. Muestra el nombre e identificador de los teléfonos habilitados, ordenados por nombre.
2. ¿Cuántos puntos GPS llegaron en los últimos 10 minutos?
3. Muestra las 10 últimas posiciones de una persona cuyo nombre contenga "san", con hora local.
4. ¿Cuántas jornadas abrió cada persona en los últimos 7 días?
5. ¿Quién tiene la batería más baja ahora mismo?

<details>
<summary>Ver soluciones</summary>

1.
```
sql select nombre, identificador from tracking.dmt_dispositivo where habilitado order by nombre
```
2.
```
sql select count(*) from tracking.dmt_posicion where registrado_en > now() - interval '10 minutes'
```
3.
```
sql select p.registrado_en at time zone 'America/Guayaquil' as hora, p.latitud, p.longitud from tracking.dmt_posicion p join tracking.dmt_dispositivo d on d.id = p.dispositivo_id where d.nombre ilike '%san%' and p.registrado_en > now() - interval '1 day' order by p.registrado_en desc limit 10
```
4.
```
sql select d.nombre, count(*) as jornadas from operations.dmt_jornada j join tracking.dmt_dispositivo d on d.id = j.dispositivo_id where j.inicio_en > now() - interval '7 days' group by d.nombre order by jornadas desc
```
5.
```
sql select d.nombre, pa.bateria_pct from tracking.dmt_posicion_actual pa join tracking.dmt_dispositivo d on d.id = pa.dispositivo_id where pa.bateria_pct is not null order by pa.bateria_pct limit 1
```
</details>

---

## Resumen en una tarjeta

```
select  columnas          ← qué quiero ver   (* = todo)
from    esquema.tabla     ← de dónde
join    otra on a = b     ← (opcional) unir para ver nombres
where   condición         ← (opcional) filtrar  · and / or / ilike '%x%'
group by columnas         ← (opcional) agrupar  · con count / max / avg
order by columna desc     ← (opcional) ordenar
limit   20                ← (opcional) cuántas filas
```

Horas locales: `columna at time zone 'America/Guayaquil'` · Tiempo atrás: `now() - interval '1 hour'`
