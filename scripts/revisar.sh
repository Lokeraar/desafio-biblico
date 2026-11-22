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

base="$(git rev-parse "$BASE_REMOTA" 2>/dev/null)"
cabeza="$(git rev-parse HEAD 2>/dev/null)"
cuantos="$(git rev-list --count "$BASE_REMOTA..HEAD" 2>/dev/null)"

# Sin estas tres, un fallo de git deja el conteo vacio y el script sigue como
# si supiera el rango: imprimiria instrucciones de revision para un rango que
# no pudo calcular, y saldria con exito.
# Si las ramas divergieron, el rango NO es lo que falta publicar: incluiria
# como reversiones los commits ajenos. Se exige que la base sea ancestro.
if ! git merge-base --is-ancestor "$base" "$cabeza" 2>/dev/null; then
  echo "  La rama local y $BASE_REMOTA DIVERGIERON."
  echo "  Revisar este rango incluiria como reversiones commits que no son tuyos."
  echo "  Resuelvelo primero: git pull --rebase origin main"
  exit 1
fi

if [ -z "$base" ] || [ -z "$cabeza" ] || [ -z "$cuantos" ]; then
  echo "  No se pudo calcular el rango (base='$base' cabeza='$cabeza' commits='$cuantos')."
  echo "  Revisa que el repositorio este sano: git status && git fetch origin"
  exit 1
fi

# Corre la autoverificacion si se pidio. Se llama en LOS DOS caminos: antes
# se salia por «al dia» sin mirar --probar, y el que lo pedia recibia un exito
# sin la comprobacion que habia pedido.
autoverificar() {
  [ "$Probar" = true ] || return 0
  echo "=== Autoverificacion (probar.sh) ==="
  if ! bash "$RAIZ/scripts/probar.sh"; then
    echo
    echo "  La autoverificacion FALLO. No se revisa todavia: primero se arregla."
    return 1
  fi
  echo
}

if [ "$cuantos" = "0" ]; then
  echo "  No hay nada sin publicar: $BASE_REMOTA esta al dia con HEAD."
  # ESTA RAMA NO PUEDE CALLAR LOS CAMBIOS SIN COMMITEAR.
  # Decir «al dia» con el arbol sucio es la mentira mas cara de todas: se lee
  # como «no hay nada que hacer» cuando en realidad hay trabajo que ni se
  # reviso ni se publico.
  # Mismo cuidado que arriba: sin comprobar el codigo, un fallo se leia como
  # «no hay nada».
  if ! suelto="$(git status --porcelain 2>&1)"; then
    echo "  git status FALLO: $(printf '%s' "$suelto" | head -1)"
    exit 1
  fi
  if [ -n "$suelto" ]; then
    echo
    echo "  PERO hay cambios sin commitear, y esos no estan publicados:"
    printf '%s\n' "$suelto" | sed 's/^/       /'
    echo "       Se pierden si se recarga la maquina. Commitealos."
    exit 1
  fi
  autoverificar || exit 1
  exit 0
fi

echo "  commits sin publicar: $cuantos"
echo "  base exacta:          $base"
echo "  cabeza:               $cabeza"
echo

# --- lo que invalida una revision en curso ---
# Un cambio sin commitear NO esta en el rango: se revisa algo y se publica
# otra cosa. Es la trampa mas silenciosa de todas.
# Se mira el CODIGO de git status, no solo su salida. Si falla -un lock del
# indice, por ejemplo- la salida queda vacia y eso se leia como «arbol
# limpio»: el script imprimia instrucciones de revision y salia 0.
if ! sucio="$(git status --porcelain 2>&1)"; then
  echo "  git status FALLO, no se puede saber si el arbol esta limpio:"
  printf '%s\n' "$sucio" | sed 's/^/       /'
  exit 1
fi
if [ -n "$sucio" ]; then
  echo "  ALTO: hay cambios sin commitear y NO entran en la revision."
  printf '%s\n' "$sucio" | sed 's/^/       /'
  echo
  echo "  Revisar ahora seria revisar una cosa y publicar otra. Commitealos"
  echo "  primero. (El refuter dijo que este aviso bastaba; medido: salia 0.)"
  exit 1
fi

echo "  commits del rango:"
git log --oneline "$BASE_REMOTA..HEAD" | sed 's/^/       /'
echo
echo "  archivos que entran:"
git diff --stat "$BASE_REMOTA..HEAD" | tail -20 | sed 's/^/       /'
echo

autoverificar || exit 1

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
