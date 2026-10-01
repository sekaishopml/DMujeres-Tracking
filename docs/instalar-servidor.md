# Instalar el servidor

Estos son los pasos para montar todo en un servidor Ubuntu limpio. El
servidor actual ya está instalado así.

## 1. Lo que hace falta instalado

- Node 24 en `/usr/local/bin/node24`.
- Docker.
- nginx.
- Java 17, para el servicio de ruteo.
- Un usuario de sistema `dmujeres`, dueño de la carpeta del proyecto. Los
  servicios corren con ese usuario.

## 2. El código

```bash
git clone https://github.com/sekaishopml/DMujeres-Tracking.git /home/DMujeres-Tracking
chown -R dmujeres:dmujeres /home/DMujeres-Tracking
```

## 3. El archivo .env

Copiar `.env.example` a `.env` en la raíz del proyecto, llenar las claves y
dejarlo con permisos 600. Ahí van el usuario y la clave de la base, la clave
que usan los teléfonos (`DMJ_CLAVE_MOVIL`) y los puertos. Este archivo nunca
se sube a git.

## 4. La base de datos

```bash
docker compose -f infraestructura/docker-compose.yml up -d
```

Cuando el contenedor `dmt-db` esté sano, se carga el esquema y después las
migraciones, en orden:

```bash
for f in base-de-datos/schema/*.sql base-de-datos/migrations/*.sql; do
  docker exec -i dmt-db psql -U dmt -d dmujeres -v ON_ERROR_STOP=1 < "$f"
done
```

Ojo: el `docker-compose` viejo (versión 1) no entiende el archivo. Hace falta
el plugin `docker compose` (versión 2).

## 5. Dependencias y panel

```bash
cd servidor/api && npm ci && cd -
cd servidor/tracking && npm ci && cd -
cd servidor/recuperacion && npm ci && cd -
cd panel && npm ci && npx vite build && cd -
```

## 6. El ruteo

El servicio de ruteo usa GraphHopper con el mapa de Ecuador ya importado en
`/opt/graphhopper` y su jar en `/opt/route-service`. Esos archivos son
grandes y no están en el repositorio. Para compilar el servicio:

```bash
bash servidor/ruteo/build.sh
```

## 7. Firebase

La recuperación por notificaciones necesita la cuenta de servicio de
Firebase. Se guarda fuera del proyecto, con permisos 600, y su ruta va en
`DMJ_FCM_CREDENCIAL`.

## 8. Servicios y nginx

```bash
sudo infraestructura/instalar.sh
```

Instala y arranca `dmj-api`, `dmj-tracking`, `dmj-panel`, `dmj-recuperacion` y
`dmj-routing`. Para nginx se copian los archivos de `infraestructura/nginx` a
`/etc/nginx/sites-available`, se enlazan en `sites-enabled` y se recarga con
`nginx -t && systemctl reload nginx`. Hay un ejemplo con HTTPS en
`dmj-tracking-tls.example`.

## 9. Respaldos

```bash
echo '30 3 * * * dmujeres /home/DMujeres-Tracking/scripts/respaldo-base.sh >> /var/log/dmj/respaldo.log 2>&1' \
  | sudo tee /etc/cron.d/dmj-respaldo
```

## 10. Comprobar

```bash
scripts/verificar-servidor.sh
```

Tiene que terminar con todo bien.

Para quitar los servicios: `sudo infraestructura/quitar.sh` (no borra la base
ni los datos).
