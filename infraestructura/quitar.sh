#!/usr/bin/env bash
# Detiene y quita los servicios del servidor. No toca la base de datos.
# Uso: sudo infraestructura/quitar.sh
set -euo pipefail

SERVICIOS=(dmj-api dmj-tracking dmj-panel dmj-recuperacion dmj-routing)

systemctl disable --now "${SERVICIOS[@]}" 2>/dev/null || true
for s in "${SERVICIOS[@]}"; do
  rm -f "/etc/systemd/system/$s.service"
done
systemctl daemon-reload
echo "Servicios quitados."
