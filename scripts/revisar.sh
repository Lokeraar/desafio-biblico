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
  # La verificacion puede dejar archivos. Si el arbol quedo sucio, el rango
  # cambió y lo revisado no seria lo que hay.
  local despues
  if ! despues="$(git status --porcelain --untracked-files=normal 2>&1)"; then
    echo "  git status fallo tras la verificacion"; return 1
  fi
  if [ -n "$despues" ]; then
    echo "  La verificacion dejo cambios en el arbol; no entran en la revision:"
    printf '%s\n' "$despues" | sed 's/^/       /'
    return 1
  fi
}

# DIVERGIR no es lo mismo que estar DETRAS.
#   - HEAD por detras: no hay nada que publicar, es un estado valido.
#   - Divergieron: el rango incluiria como reversiones commits ajenos.
# Antes se trataban igual y «detras» se reportaba como divergencia.
if ! git merge-base --is-ancestor "$base" "$cabeza" 2>/dev/null; then
  if git merge-base --is-ancestor "$cabeza" "$base" 2>/dev/null; then
    echo "  La rama local esta DETRAS de $BASE_REMOTA: no hay nada que publicar."
    echo "  Para ponerte al dia: git pull --ff-only origin main"
    autoverificar || exit 1
    exit 0
  fi
  echo "  La rama local y $BASE_REMOTA DIVERGIERON."
  echo "  Revisar este rango incluiria como reversiones commits que no son tuyos."
  echo "  Resuelvelo primero: git pull --rebase origin main"
  exit 1
fi

if [ "$cuantos" = "0" ]; then
  echo "  No hay nada sin publicar: $BASE_REMOTA esta al dia con HEAD."
  # ESTA RAMA NO PUEDE CALLAR LOS CAMBIOS SIN COMMITEAR.
  # Decir «al dia» con el arbol sucio es la mentira mas cara de todas: se lee
  # como «no hay nada que hacer» cuando en realidad hay trabajo que ni se
  # reviso ni se publico.
  # Mismo cuidado que arriba: sin comprobar el codigo, un fallo se leia como
  # «no hay nada».
  if ! suelto="$(git status --porcelain --untracked-files=normal 2>&1)"; then
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
if ! sucio="$(git status --porcelain --untracked-files=normal 2>&1)"; then
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
# Sin comprobar el codigo, un fallo de git log dejaba el script saliendo 0 sin
# imprimir el rango que promete. Se comprueba.
if ! lista="$(git log --oneline "$BASE_REMOTA..HEAD" 2>&1)"; then
  echo "  git log FALLO, no se puede listar el rango:"
  printf '%s\n' "$lista" | head -3 | sed 's/^/       /'
  exit 1
fi
printf '%s\n' "$lista" | sed 's/^/       /'
echo
echo "  archivos que entran:"
if ! est="$(git diff --stat "$BASE_REMOTA..HEAD" 2>&1)"; then
  echo "  git diff FALLO, no se pueden listar los archivos:"
  printf '%s\n' "$est" | head -3 | sed 's/^/       /'
  exit 1
fi
# Se DICE cuando se recorta. Antes ponia «los archivos que entran» y cortaba a
# 20 lineas en silencio: en un rango grande faltaban archivos sin avisar.
lineas_est="$(printf '%s\n' "$est" | wc -l)"
if [ "$lineas_est" -gt 20 ]; then
  printf '%s\n' "$est" | head -19 | sed 's/^/       /'
  echo "       ... y $((lineas_est - 19)) lineas mas (recortado a proposito)"
else
  printf '%s\n' "$est" | sed 's/^/       /'
fi
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
