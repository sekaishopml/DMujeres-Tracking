#!/usr/bin/env bash
# Publica una nueva versión de la app para todos los teléfonos.
#
# Compila el APK firmado, lo deja en ota/ y actualiza ota/latest.json. Los
# teléfonos lo ven la próxima vez que consultan si hay actualización.
#
# Uso:     scripts/publicar-app.sh <versión> "<qué cambió>"
# Ejemplo: scripts/publicar-app.sh 2.4.2 "Cronograma más cómodo"
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"

# Se compila como el usuario dueño del proyecto, que tiene la caché de Gradle.
DUENO="$(stat -c %U "$RAIZ")"
if [ "$(id -u)" = 0 ] && [ "$DUENO" != root ]; then
  exec su "$DUENO" -c "$(printf '%q ' "$RAIZ/scripts/publicar-app.sh" "$@")"
fi
cd "$RAIZ"

VERSION="${1:?Uso: publicar-app.sh <versión> \"<qué cambió>\"}"
NOTAS="${2:?Uso: publicar-app.sh <versión> \"<qué cambió>\"}"
GRADLE=app/app/build.gradle
APK=app/app/build/outputs/apk/google/release/app-google-release.apk
DESTINO="ota/DMujeres-Tracking-$VERSION.apk"

# El número interno de versión siempre sube uno respecto al publicado.
ACTUAL=$(node -e "console.log(require('$RAIZ/ota/latest.json').versionCode)")
VC=$((ACTUAL + 1))
echo "Versión $VERSION (código $VC)"

# Si algo falla antes de terminar, todo vuelve a como estaba.
cp "$GRADLE" "$GRADLE.antes"
LISTO=0
deshacer() {
  if [ "$LISTO" = 0 ]; then
    mv "$GRADLE.antes" "$GRADLE"
    rm -f "$DESTINO"
    echo "No se publicó nada."
  fi
}
trap deshacer EXIT

sed -i -E "s/versionCode [0-9]+/versionCode $VC/" "$GRADLE"
sed -i -E "s/versionName '[^']+'/versionName '$VERSION'/" "$GRADLE"

export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
rm -f "$APK"
(cd app && ./gradlew assembleGoogleRelease --offline -q)
test -f "$APK" || { echo "No se generó el APK"; exit 1; }

# Con otra firma los teléfonos rechazan la actualización.
FIRMA=$(keytool -printcert -jarfile "$APK" 2>/dev/null | grep -m1 "SHA256" || true)
case "$FIRMA" in
  *86:7B:A1:29*) echo "Firma correcta" ;;
  *) echo "La firma no es la de siempre: $FIRMA"; exit 1 ;;
esac

cp "$APK" "$DESTINO"
CODIGO=$(curl -s -m 20 -o /dev/null -w "%{http_code}" "http://68.168.20.219:999/DMujeres-Tracking-$VERSION.apk")
test "$CODIGO" = "200" || { echo "Nginx no entrega el APK (HTTP $CODIGO)"; exit 1; }

# Último paso: desde aquí los teléfonos ven la versión nueva.
SHA=$(sha256sum "$DESTINO" | cut -d' ' -f1)
node -e "
const fs = require('fs');
const m = { version: '$VERSION', versionCode: $VC,
  url: 'http://68.168.20.219:999/DMujeres-Tracking-$VERSION.apk',
  notes: process.argv[1], sha256: '$SHA' };
fs.writeFileSync('ota/latest.json', JSON.stringify(m, null, 2) + '\n');
" "$NOTAS"
LISTO=1
rm -f "$GRADLE.antes"

git add "$GRADLE"
git commit -q -m "Versión $VERSION de la app" || true
echo "Listo. Los teléfonos ya pueden actualizar a la $VERSION."
echo "Para el respaldo en GitHub: scripts/publicar-en-github.sh $VERSION"
