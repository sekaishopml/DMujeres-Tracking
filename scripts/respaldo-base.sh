#!/usr/bin/env bash
# Respaldo diario de la base de datos (lo corre cron a las 03:30).
# Uso: scripts/respaldo-base.sh [etiqueta]
#
# Guarda el volcado de la base y una copia del .env en /home/DMujeres-backups/nueva,
# comprueba que el volcado se puede abrir y borra los de más de 14 días.
set -euo pipefail

CONTENEDOR="${DMJ_DB_CONTENEDOR:-dmt-db}"
USUARIO="${DMJ_DB_USUARIO:-dmt}"
BASE="${DMJ_DB_NOMBRE:-dmujeres}"
DESTINO="${DMJ_BACKUP_NUEVA:-/home/DMujeres-backups/nueva}"
TAG="${1:-$(date +%Y%m%d-%H%M%S)}"

mkdir -p "$DESTINO"
chmod 700 "$DESTINO"

echo "==> Dump $BASE -> $DESTINO/dmujeres-$TAG.dump"
docker exec "$CONTENEDOR" pg_dump -U "$USUARIO" -d "$BASE" --format=custom > "$DESTINO/dmujeres-$TAG.dump"

# Un respaldo no verificado no es un respaldo: pg_restore --list falla si está corrupto.
docker exec -i "$CONTENEDOR" pg_restore --list < "$DESTINO/dmujeres-$TAG.dump" > /dev/null
echo "==> dump verificado"

install -m 600 /home/DMujeres-Tracking/.env "$DESTINO/env-$TAG"
(cd "$DESTINO" && sha256sum "dmujeres-$TAG.dump" "env-$TAG" > "SHA256SUMS-$TAG")

# Retención: se conservan 14 días.
find "$DESTINO" -maxdepth 1 -name 'dmujeres-*.dump' -mtime +14 -delete
find "$DESTINO" -maxdepth 1 -name 'env-*' -mtime +14 -delete
find "$DESTINO" -maxdepth 1 -name 'SHA256SUMS-*' -mtime +14 -delete

echo "==> listo: $DESTINO/dmujeres-$TAG.dump ($(du -h "$DESTINO/dmujeres-$TAG.dump" | cut -f1))"
