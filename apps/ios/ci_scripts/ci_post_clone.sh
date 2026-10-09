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

# Xcode Cloud no resuelve paquetes sin Package.resolved, y ese archivo vive
# dentro del proyecto generado, que no se versiona. Se guarda en
# apps/ios/Package.resolved y se copia aquí.
swiftpm=Planificador.xcodeproj/project.xcworkspace/xcshareddata/swiftpm
if [ -f Package.resolved ]; then
  mkdir -p "$swiftpm"
  cp Package.resolved "$swiftpm/Package.resolved"
fi

# Las dependencias cambian según la versión de Xcode (con Xcode 27,
# supabase-swift pide swift-issue-reporting), y Xcode Cloud no deja que se
# actualice el archivo. Solo para este paso se permite: parte de las versiones
# guardadas y agrega lo que falte. El archive de después usa el archivo ya al día.
defaults write com.apple.dt.Xcode IDEPackageOnlyUseVersionsFromResolvedFile -bool NO
defaults write com.apple.dt.Xcode IDEDisableAutomaticPackageResolution -bool NO
xcodebuild -resolvePackageDependencies -project Planificador.xcodeproj -scheme Planificador
echo "Package.resolved con el que se compila:"
cat "$swiftpm/Package.resolved"
