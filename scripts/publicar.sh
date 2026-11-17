#!/usr/bin/env bash
# =====================================================================
# Publicar: commit y push de este proyecto, en un solo paso.
# ---------------------------------------------------------------------
# Existe porque las mismas dos cosas se rompían en cada entrega:
#
#   1. El `cd`. La sesión del agente arranca parada en la carpeta VIEJA
#      (/home/Projects/Desafío-Bíblico), que ya no es un repositorio. Un
#      `cd` que falla deja el comando corriendo en el directorio
#      equivocado, y ahí `git` no encuentra nada.
#   2. El guardia de entrega. Rechaza `push` cuando el repositorio no se
#      puede resolver desde el directorio actual.
#
# Las dos se resuelven igual: con `git -C` y la ruta ABSOLUTA del
# repositorio, nunca con `cd`. Este script hace siempre eso, así que
# funciona lo mismo desde cualquier directorio.
#
# Uso:
#   bash scripts/publicar.sh "Mensaje del commit"   # commit + push + verificación
#   bash scripts/publicar.sh -n "Mensaje"           # solo commit, sin push
#
# Si no hay cambios, avisa y termina sin error: volver a publicar lo mismo
# no es un fallo, y tratarlo como tal hace perder tiempo.
#
# DETALLE IMPORTANTE: todo el trabajo (commit, push, verificación) se hace
# ANTES de imprimir el resumen. Así, si alguien corta la salida —por
# ejemplo con `| head`— el trabajo ya está hecho y no queda a medias. Se
# aprendió probando este mismo script con `head -3`: moría por la señal
# del tubo antes de commitear, en silencio.
# =====================================================================
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RAMA="${RAMA:-main}"

sin_push=false
if [ "${1:-}" = "-n" ] || [ "${1:-}" = "--no-push" ]; then
  sin_push=true
  shift
fi

MENSAJE="${1:-}"
if [ -z "$MENSAJE" ]; then
  echo "ERROR: falta el mensaje del commit." >&2
  echo "Uso: bash scripts/publicar.sh \"Mensaje del commit\"" >&2
  exit 2
fi

if [ ! -d "$RAIZ/.git" ]; then
  echo "ERROR: $RAIZ no es un repositorio git." >&2
  exit 1
fi

# `git -C` con ruta absoluta, SIEMPRE. Ni un `cd` en todo el script.
git_en() { git -C "$RAIZ" "$@"; }

# Todo lo que se imprime se acumula aquí y se muestra al final.
salida=""

# --- Preparar -------------------------------------------------------
git_en add -A

if git_en diff --cached --quiet; then
  echo "Nada que publicar: no hay cambios."
  exit 0
fi

salida+="--- Lo que se commitea ---"$'\n'
salida+="$(git_en diff --cached --stat | tail -15)"$'\n'

# --- Commit ---------------------------------------------------------
if ! git_en commit -q -m "$MENSAJE"; then
  echo "ERROR: el commit falló. Nada se publicó." >&2
  exit 1
fi
SHA="$(git_en rev-parse --short HEAD)"
salida+="Commit $SHA: $(git_en log -1 --pretty=%s)"$'\n'

# --- Push -----------------------------------------------------------
estado_remoto=""
if [ "$sin_push" = true ]; then
  salida+="Sin push (opción -n)."$'\n'
  printf '%s' "$salida"
  exit 0
fi

if ! git_en push origin "$RAMA" >/dev/null 2>&1; then
  echo "ERROR: el commit está hecho ($SHA) pero el push falló." >&2
  echo "Para reintentar solo el envío: git -C $RAIZ push origin $RAMA" >&2
  printf '%s' "$salida"
  exit 1
fi
salida+="Subido a origin/$RAMA."$'\n'

# --- Verificación contra el remoto DE VERDAD ------------------------
# No sirve comparar con `origin/$RAMA`: el push ya actualizó esa
# referencia local, así que la comparación diría siempre que sí. Se le
# pregunta al remoto por el hash de la rama.
if REMOTO="$(git_en ls-remote origin "refs/heads/$RAMA" 2>/dev/null | cut -f1)" \
   && [ -n "$REMOTO" ]; then
  LOCAL="$(git_en rev-parse HEAD)"
  if [ "$LOCAL" = "$REMOTO" ]; then
    salida+="Verificado contra el remoto: $RAMA = $SHA."$'\n'
  else
    estado_remoto="AVISO: el remoto no coincide (local $LOCAL, remoto $REMOTO)."
  fi
else
  # Sin red no se puede verificar. El push ya ocurrió, así que esto no es
  # un fallo del push: se dice y se sigue.
  estado_remoto="No se pudo verificar contra el remoto (sin conexión o sin permiso de lectura)."
fi

printf '%s' "$salida"
if [ -n "$estado_remoto" ]; then
  echo "$estado_remoto" >&2
fi

# --- Propagación del sitio ------------------------------------------
# GitHub Pages sirve este repositorio desde `main`, sin flujo de trabajo:
# subir ES publicar. Tarda unos segundos, así que se comprueba en vez de
# darlo por hecho. Se comparan los BYTES del archivo cambiado, no una
# cadena buscada: es la única comparación que no se puede falsear.
URL_SITIO="${URL_SITIO:-https://lokeraar.github.io/desafio-biblico/}"
ARCHIVO="$(git_en diff --name-only HEAD~1 HEAD 2>/dev/null | rg -m1 '\.(js|css|html)$' || true)"
if [ -n "$ARCHIVO" ] && command -v curl >/dev/null 2>&1; then
  for intento in 1 2 3 4 5 6 7; do
    sleep 8
    if curl -s -m 20 -H 'Cache-Control: no-cache' \
         "$URL_SITIO$ARCHIVO?v=$SHA$intento" 2>/dev/null \
       | cmp -s - "$RAIZ/$ARCHIVO"; then
      echo "Sitio verificado: $ARCHIVO se sirve igual que en el repositorio."
      exit 0
    fi
  done
  echo "AVISO: $ARCHIVO todavía no coincide con el sitio publicado." >&2
  echo "Puede tardar más, o el archivo puede no estar incluido en el sitio." >&2
fi
