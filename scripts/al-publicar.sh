#!/data/data/com.termux/files/usr/bin/bash
# Gancho de Desafío Bíblico: lo que es específico de ESTE proyecto tras
# publicar. La lógica de commit y push la hace `publicar`, que es general.
#
# Aquí: comprobar que GitHub Pages sirva de verdad el archivo nuevo. El
# sitio se sirve desde `main` sin flujo de trabajo, así que subir ES
# publicar, pero tarda unos segundos y antes eso se comprobaba a mano en
# cada entrega.
set -uo pipefail

SHA="${1:-}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URL_SITIO="${URL_SITIO:-https://lokeraar.github.io/desafio-biblico/}"

command -v curl >/dev/null 2>&1 || { echo "Sin curl: no se comprueba el sitio."; exit 0; }

# El primer archivo servible que cambió en este commit. Se comparan BYTES
# contra el repositorio, no una cadena buscada: una cadena puede aparecer
# por casualidad y dar por bueno lo que no está.
ARCHIVO="$(git -C "$RAIZ" diff --name-only HEAD~1 HEAD 2>/dev/null \
  | rg -m1 '\.(js|css|html|md|json)$' || true)"

# Se dice explícitamente cuando no hay nada que comprobar. Callar sería
# indistinguible de «el gancho no corrió», y eso hace dudar del push que
# sí ocurrió.
if [ -z "$ARCHIVO" ]; then
  echo "Nada servible que verificar en este commit (solo scripts o borrados)."
  exit 0
fi

for intento in 1 2 3 4 5 6 7; do
  sleep 8
  if curl -s -m 20 -H 'Cache-Control: no-cache' \
       "${URL_SITIO}${ARCHIVO}?v=${SHA}${intento}" 2>/dev/null \
     | cmp -s - "$RAIZ/$ARCHIVO"; then
    echo "Sitio verificado: $ARCHIVO se sirve igual que en el repositorio."
    exit 0
  fi
done

echo "AVISO: $ARCHIVO todavía no coincide con el sitio publicado." >&2
echo "Puede tardar más, o el archivo puede no estar incluido en el sitio." >&2
exit 1
