#!/usr/bin/env bash
# Instala y arranca los servicios del servidor (systemd).
# Uso: sudo infraestructura/instalar.sh
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ORIGEN="$RAIZ/infraestructura/systemd"
SERVICIOS=(dmj-api dmj-tracking dmj-panel dmj-recuperacion dmj-routing)

for s in "${SERVICIOS[@]}"; do
  install -m 0644 "$ORIGEN/$s.service" "/etc/systemd/system/$s.service"
done
systemctl daemon-reload
systemctl enable --now "${SERVICIOS[@]}"
sleep 3

for s in "${SERVICIOS[@]}"; do
  printf '%-18s %s\n' "$s" "$(systemctl is-active "$s")"
done
echo "API:   $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/api/v1/health)"
echo "Panel: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8999/)"
