#!/usr/bin/env bash
# Compila el servicio de ruteo. Usa el jar de GraphHopper 8 que ya trae todas
# sus dependencias (/opt/route-service/matchservice.jar), así que no hace falta
# Maven. El mapa se lee de /opt/graphhopper.
#
# Uso: bash servidor/ruteo/build.sh
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESTINO="${DESTINO:-/opt/route-service}"
JAR="${JAR:-$DESTINO/matchservice.jar}"

if [[ ! -f "$JAR" ]]; then
  echo "Falta el jar de GraphHopper en $JAR." >&2
  exit 1
fi

mkdir -p "$DESTINO/clases"
javac -cp "$JAR" -d "$DESTINO/clases" "$AQUI/RouteService.java"
echo "Compilado. Arranque: java -Xmx768m -cp $JAR:$DESTINO/clases dmj.RouteService"
