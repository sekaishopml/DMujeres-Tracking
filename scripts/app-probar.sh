#!/usr/bin/env bash
# Trae main de GitHub y comprueba que la app compila y pasa sus pruebas.
# No publica nada.
set -euo pipefail
RAIZ="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
DUENO="$(stat -c %U "$RAIZ")"
cd "$RAIZ"
# Git corre como quien escribe el comando (tiene la llave de GitHub).
g() { git -c safe.directory="$RAIZ" "$@"; }
if [ -n "$(g status --porcelain --untracked-files=no)" ]; then
  echo "Hay cambios sin guardar en el servidor; no se trae nada:"; g status --short | head; exit 1
fi
g switch -q main
g pull --ff-only -q
[ "$(id -u)" = 0 ] && chown -R "$DUENO:$DUENO" "$RAIZ"
echo "main al día: $(g log --oneline -1)"
# Gradle corre como el dueño del proyecto, que tiene su caché.
COMPILAR='cd app && ANDROID_HOME=/opt/android-sdk ./gradlew assembleGoogleRelease testGoogleReleaseUnitTest --offline -q'
if [ "$(id -u)" = 0 ] && [ "$DUENO" != root ]; then su "$DUENO" -c "$COMPILAR"; else bash -c "$COMPILAR"; fi
echo "La app compila y pasa las pruebas."
