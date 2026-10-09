#!/bin/sh
# Xcode Cloud corre este script justo después de clonar el repositorio.
# El .xcodeproj no se versiona y Secrets.xcconfig vive solo en cada Mac, así
# que aquí se arman los dos antes de compilar.
#
# Variables que hay que definir en el workflow de Xcode Cloud (Environment):
#   SUPABASE_URL       https://TU-PROYECTO.supabase.co
#   SUPABASE_ANON_KEY  la clave anon (márcala como secreta)
#   DEVELOPMENT_TEAM   el Team ID de 10 caracteres
set -eu

cd "$(dirname "$0")/.."

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_ANON_KEY:-}" ]; then
  echo "error: faltan SUPABASE_URL o SUPABASE_ANON_KEY en las variables del workflow de Xcode Cloud"
  exit 1
fi

# En .xcconfig "//" empieza un comentario: la URL se escribe con "/$()/".
url=$(printf '%s' "$SUPABASE_URL" | sed 's#//#/$()/#')
cat > Config/Secrets.xcconfig <<SECRETS
SUPABASE_URL = $url
SUPABASE_ANON_KEY = $SUPABASE_ANON_KEY
DEVELOPMENT_TEAM = ${DEVELOPMENT_TEAM:-}
SECRETS

brew install xcodegen
xcodegen generate

# Xcode Cloud no resuelve paquetes por su cuenta y exige Package.resolved,
# que vive dentro del proyecto generado.
xcodebuild -resolvePackageDependencies -project Planificador.xcodeproj -scheme Planificador
