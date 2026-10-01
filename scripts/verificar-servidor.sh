#!/usr/bin/env bash
# Revisa que el servidor esté funcionando: servicios, pruebas, panel, canal de
# la app, actualización y base de datos. Solo lee; no cambia nada.
#
# Uso: scripts/verificar-servidor.sh
set -uo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
CLAVE_MOVIL="$(grep -m1 '^DMJ_CLAVE_MOVIL=' "$RAIZ/.env" | cut -d= -f2-)"
NODE="${NODE:-node24}"
bien=0
mal=0

ok()    { echo "  bien   $1"; bien=$((bien + 1)); }
falla() { echo "  FALLA  $1"; mal=$((mal + 1)); }

http() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@" || true
}

echo "Servicios"
for servicio in dmj-api dmj-tracking dmj-panel dmj-recuperacion dmj-routing nginx; do
  if systemctl is-active --quiet "$servicio"; then ok "$servicio"; else falla "$servicio no está activo"; fi
done

echo "Pruebas"
if (cd "$RAIZ/servidor/api" && $NODE --test test/*.test.mjs >/dev/null 2>&1); then ok "pruebas de la API"; else falla "pruebas de la API"; fi
if (cd "$RAIZ/servidor/tracking" && $NODE --test test/*.test.mjs >/dev/null 2>&1); then ok "pruebas del receptor"; else falla "pruebas del receptor"; fi

echo "Panel y API"
[ "$(http http://127.0.0.1/)" = 200 ] && ok "panel por el puerto 80" || falla "panel por el puerto 80"
[ "$(http http://127.0.0.1:999/)" = 200 ] && ok "panel por el puerto 999" || falla "panel por el puerto 999"
[ "$(http http://127.0.0.1:8999/)" = 200 ] && ok "panel directo (8999)" || falla "panel directo (8999)"
[ "$(curl -s --max-time 10 http://127.0.0.1/api/v1/health)" = '{"estado":"ok"}' ] && ok "API" || falla "API no responde ok"
[ "$(curl -s --max-time 5 http://127.0.0.1:8992/health)" = ok ] && ok "ruteo por calles" || falla "ruteo por calles"

echo "App"
[ "$(http -H "X-Api-Key: $CLAVE_MOVIL" -H 'X-Device-Id: macias' http://127.0.0.1:999/api/mobile/v1/config)" = 200 ] \
  && ok "canal de la app" || falla "canal de la app"
VERSION="$(python3 -c "import json;print(json.load(open('$RAIZ/ota/latest.json'))['version'])" 2>/dev/null)"
[ "$(http "http://127.0.0.1:999/DMujeres-Tracking-$VERSION.apk")" = 200 ] \
  && ok "APK de la versión $VERSION" || falla "no se descarga el APK de la versión $VERSION"

echo "Base de datos"
POSICIONES="$(docker exec dmt-db psql -U dmt -d dmujeres -tAc 'SELECT count(*) FROM tracking.dmt_posicion' 2>/dev/null | tr -d '[:space:]')"
[[ "$POSICIONES" =~ ^[0-9]+$ ]] && ok "base en línea ($POSICIONES puntos guardados)" || falla "no se pudo leer la base"

echo
echo "$bien bien, $mal con falla"
[ "$mal" -eq 0 ]
