#!/bin/bash
# Única orden que puede usar la llave de depuración del PC (va en
# authorized_keys con command=; ver scripts/depuracion-qr.ps1). El PC abre
# los túneles 41473 (conexión) y 41474 (vinculación) hacia el teléfono y pide
# aquí vincular, conectar o el estado. Nada más.
set -u
export PATH=/opt/android-sdk/platform-tools:/usr/bin:/bin
read -r orden argumento resto <<<"${SSH_ORIGINAL_COMMAND:-}"
case "${orden:-}" in
  vincular)
    [[ "${argumento:-}" =~ ^[A-Za-z0-9]{6,32}$ ]] || { echo "clave no válida"; exit 2; }
    timeout 40 adb pair 127.0.0.1:41474 "$argumento" 2>&1 ;;
  conectar)
    adb disconnect 127.0.0.1:41473 >/dev/null 2>&1
    timeout 20 adb connect 127.0.0.1:41473 2>&1
    sleep 2
    timeout 10 adb -s 127.0.0.1:41473 get-state 2>&1 ;;
  estado)
    timeout 10 adb -s 127.0.0.1:41473 get-state 2>&1 ;;
  *)
    echo "orden no permitida"; exit 1 ;;
esac
