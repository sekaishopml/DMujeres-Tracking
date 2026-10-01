# El día a día

## Revisar que todo esté bien

```bash
scripts/verificar-servidor.sh
```

Revisa los servicios, las pruebas de la API y del tracking, el panel en los
puertos 80, 999 y 8999, el ruteo, el canal de los teléfonos, el APK publicado
y la base de datos. Si algo sale mal, lo dice.

Para ver qué está pasando en un servicio:

```bash
journalctl -u dmj-tracking -f
```

## Publicar una versión nueva de la app

```bash
scripts/publicar-app.sh 2.4.3 "Qué cambió, en una frase"
```

El script sube el número de versión, compila el APK firmado, revisa que la
firma sea la de siempre, lo deja en `ota/` y actualiza `ota/latest.json`. Los
teléfonos lo ven la próxima vez que abren la app o al minuto si ya está
abierta. Si algo falla en el camino, deja todo como estaba y no publica nada.

Después conviene subir el mismo APK a GitHub, porque los teléfonos que no
llegan al puerto 999 (en algunos planes de datos está bloqueado) buscan la
actualización ahí:

```bash
scripts/publicar-en-github.sh
```

Pide un token de GitHub por teclado y no lo guarda.

Para soltar una versión solo a algunos teléfonos se usa `ota/rollout.json`:
`percent` es el porcentaje de la flota que la recibe y `allow` una lista de
equipos que la reciben siempre.

## Cambios en el panel

```bash
cd panel && npx tsc -b --noEmit && npx vite build
```

En cada entrega se sube la versión en `panel/package.json`. El servicio
`dmj-panel` sirve lo que hay en `panel/dist`, así que no hace falta
reiniciarlo.

## Cambios en el servidor

Las pruebas de cada servicio se corren con:

```bash
cd servidor/api && node24 --test test/*.test.mjs
cd servidor/tracking && node24 --test test/*.test.mjs
```

Después: `sudo systemctl restart dmj-api` (o el servicio que se tocó).

## Cambios en la base de datos

Cada cambio va en un archivo nuevo dentro de `base-de-datos/migrations`, con
el número siguiente. Se aplica con:

```bash
docker exec -i dmt-db psql -U dmt -d dmujeres -v ON_ERROR_STOP=1 < base-de-datos/migrations/009_lo_que_sea.sql
```

Antes, un respaldo: `scripts/respaldo-base.sh antes-de-009`.

## Respaldos

Todos los días a las 03:30 se guarda un volcado de la base y una copia del
`.env` en `/home/DMujeres-backups/nueva`. El script comprueba que el volcado
se pueda leer y borra los de más de 14 días.

Para restaurar uno:

```bash
docker exec -i dmt-db pg_restore -U dmt -d dmujeres --clean --if-exists < /home/DMujeres-backups/nueva/dmujeres-FECHA.dump
```

Conviene guardar de vez en cuando una copia de esos respaldos fuera del
servidor.

## Si un teléfono no aparece en el mapa

1. En el panel, pantalla Batería o Sistema: ver cuándo reportó por última vez
   y si tiene la ubicación apagada o le falta algún permiso.
2. Pedir a la persona que abra la app y toque ACTUALIZAR. El botón muestra
   cada paso y dice cuál falla.
3. Si dice sin conexión, revisar que llegue al puerto 999 del servidor.
4. En teléfonos Xiaomi, Huawei, Oppo y parecidos, revisar que la app tenga
   permitido el inicio automático y sin ahorro de batería.
