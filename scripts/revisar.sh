#!/usr/bin/env bash
# Prepara la revision nativa de lo que falta publicar, en un solo paso.
#
# POR QUE EXISTE
# -------------
# Costo TRES revisiones seguidas para subir cinco commits. El motivo no fue el
# codigo: se commiteaba, se revisaba, se volvia a commitear, se revisaba otra
# vez... y cada commit invalidaba la revision anterior. El guardia de entrega
# revisa el RANGO COMPLETO sin publicar (`origin/main..HEAD`), no cada commit.
#
# Este script contesta las preguntas que se hicieron a mano, en el orden en que
# hay que hacerlas, y se niega a seguir cuando algo va a invalidar la revision.
#
# USO
#   bash scripts/revisar.sh          # dice que revisar y como
#   bash scripts/revisar.sh --probar  # ademas corre probar.sh primero
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ" || exit 1

BASE_REMOTA="origin/main"
Probar=false
[ "${1:-}" = "--probar" ] && Probar=true

echo "=== Revision: que falta publicar ==="

if ! git rev-parse --verify --quiet "$BASE_REMOTA" >/dev/null; then
  echo "  FALTA la referencia $BASE_REMOTA."
  echo "  Sin ella no se puede calcular el rango. Corre: git fetch origin"
  exit 1
fi

base="$(git rev-parse "$BASE_REMOTA")"
cabeza="$(git rev-parse HEAD)"
cuantos="$(git rev-list --count "$BASE_REMOTA..HEAD")"

if [ "$cuantos" = "0" ]; then
  echo "  No hay nada sin publicar: $BASE_REMOTA esta al dia con HEAD."
  # ESTA RAMA NO PUEDE CALLAR LOS CAMBIOS SIN COMMITEAR.
  # Decir «al dia» con el arbol sucio es la mentira mas cara de todas: se lee
  # como «no hay nada que hacer» cuando en realidad hay trabajo que ni se
  # reviso ni se publico.
  suelto="$(git status --porcelain)"
  if [ -n "$suelto" ]; then
    echo
    echo "  PERO hay cambios sin commitear, y esos no estan publicados:"
    printf '%s\n' "$suelto" | sed 's/^/       /'
    echo "       Se pierden si se recarga la maquina. Commitealos."
    exit 1
  fi
  exit 0
fi

echo "  commits sin publicar: $cuantos"
echo "  base exacta:          $base"
echo "  cabeza:               $cabeza"
echo

# --- lo que invalida una revision en curso ---
# Un cambio sin commitear NO esta en el rango: se revisa algo y se publica
# otra cosa. Es la trampa mas silenciosa de todas.
sucio="$(git status --porcelain)"
if [ -n "$sucio" ]; then
  echo "  OJO: hay cambios sin commitear y NO entran en la revision."
  printf '%s\n' "$sucio" | sed 's/^/       /'
  echo "       Commitea primero, o la revision no estara mirando lo que publicas."
  echo
fi

echo "  commits del rango:"
git log --oneline "$BASE_REMOTA..HEAD" | sed 's/^/       /'
echo
echo "  archivos que entran:"
git diff --stat "$BASE_REMOTA..HEAD" | tail -20 | sed 's/^/       /'
echo

if [ "$Probar" = true ]; then
  echo "=== Autoverificacion (probar.sh) ==="
  if ! bash "$RAIZ/scripts/probar.sh"; then
    echo
    echo "  La autoverificacion FALLO. No se revisa todavia: primero se arregla."
    exit 1
  fi
  echo
fi

cat <<FIN
=== Lo que hay que hacer ahora, sin dar vueltas ===

UNA sola revision, sobre el rango entero. No una por commit.

  1. gentle_review con {"operation":"assess"} y:
       {"baseRef":"$base","committedOnly":true}
     Devuelve reviewDue y el baseRef EXACTO que quiere. Usa el suyo.

  2. UNA llamada a gentle_review_run con ese baseRef, committedOnly: true
     y las lentes que correspondan. Esa hace el ciclo completo
     (assess, inspect, start, capturas y cierre).

  3. NO llamar a mano inspect / start / status / capture en secuencia:
     eso es lo que produjo las vueltas de tres revisiones.

  4. Si la revision devuelve hallazgos: corregir, COMMITEAR, y recien
     entonces esperar otra revision. Un arreglo sin commitear no entra
     en el rango y la revision vuelve a empezar.
FIN
