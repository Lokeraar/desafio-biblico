#!/usr/bin/env bash
# Levanta el juego en local para verlo funcionando.
#
# Por qué existe: tras un reinicio hay que volver a arrancarlo, y el
# comando largo se olvida. Además `python3 -m http.server` manda
# `Last-Modified` y el navegador se queda con el `app.js` viejo: se
# corrige algo y «no hace nada». Aquí se sirve con `no-store`.
#
# Uso:
#   bash scripts/servir.sh          # puerto 8765
#   bash scripts/servir.sh 9000     # otro puerto
#   bash scripts/servir.sh --parar  # lo detiene
#
# Sale con 0 si el servidor quedó respondiendo.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUERTO="${1:-8765}"
LOG="$RAIZ/.logs/server.log"

mkdir -p "$RAIZ/.logs"

detener() {
  local pids
  pids="$(ps -eo pid,args 2>/dev/null | grep -E "[s]ervir\.py" | awk '{print $1}')"
  if [ -z "$pids" ]; then
    echo "No había ningún servidor corriendo."
    return 1
  fi
  # shellcheck disable=SC2086
  kill -9 $pids 2>/dev/null
  echo "Servidor detenido."
  return 0
}

if [ "$PUERTO" = "--parar" ] || [ "$PUERTO" = "-p" ]; then
  detener
  exit $?
fi

# Un servidor viejo en el mismo puerto impide arrancar: se retira primero.
if ps -eo args 2>/dev/null | grep -q "[s]ervir\.py"; then
  detener >/dev/null
fi

cd "$RAIZ" || exit 1

python3 "$RAIZ/scripts/servir.py" "$PUERTO" >"$LOG" 2>&1 &
sleep 2

if ! curl -s -o /dev/null -m 5 "http://127.0.0.1:$PUERTO/"; then
  echo "FALLA: el servidor no responde en el puerto $PUERTO."
  echo "Últimas líneas del registro:"
  tail -10 "$LOG"
  exit 1
fi

IP="$(python3 -c "
import socket
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(('8.8.8.8', 80))
    print(s.getsockname()[0])
    s.close()
except Exception:
    print('')
" 2>/dev/null)"

echo "Servidor arriba, sin caché."
echo
echo "  Este dispositivo:   http://127.0.0.1:$PUERTO/"
if [ -n "$IP" ]; then
  echo "  Misma red wifi:     http://$IP:$PUERTO/"
  case "$IP" in
    100.64.*|10.*) echo "                      (red móvil con NAT: puede no alcanzarse desde otro teléfono)" ;;
  esac
fi
echo
echo "  Para detenerlo:     bash scripts/servir.sh --parar"
echo
echo "Recuerda: en Brave, la primera vez vacía la caché"
echo "(mantén pulsado recargar -> Vaciar caché)."
