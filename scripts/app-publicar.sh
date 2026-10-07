#!/usr/bin/env bash
# Publica la app con el número de versión siguiente.
# Uso: dmj-publicar "una frase de lo que cambió"
set -euo pipefail
RAIZ="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
DUENO="$(stat -c %U "$RAIZ")"
cd "$RAIZ"
NOTA="${1:?Uso: dmj-publicar \"una frase de lo que cambió\"}"
ACTUAL=$(node24 -e "console.log(require('$RAIZ/ota/latest.json').version)")
NUEVA=$(echo "$ACTUAL" | awk -F. '{print $1"."$2"."$3+1}')
echo "Publicando $ACTUAL -> $NUEVA"
bash scripts/publicar-app.sh "$NUEVA" "$NOTA"   # compila, firma y hace el commit de versión
# El push lo hace quien escribe el comando (tiene la llave de GitHub).
if git -c safe.directory="$RAIZ" push -q; then echo "Subido a GitHub."; else echo "No se pudo subir: corre 'git push' en $RAIZ."; fi
