#!/data/data/com.termux/files/usr/bin/bash
# =====================================================================
# El candado de intentos, probado como llega de verdad
# ---------------------------------------------------------------------
# `smoke.sql` prueba la mecánica del conteo, pero corre dentro de UNA
# transacción. El candado, en producción, llega al revés: cada intento es su
# propia llamada RPC, o sea su propia transacción. Y esa diferencia es
# justamente la que hacía que el candado no existiera: el error de un intento
# deshacía la escritura de ese intento.
#
# Por eso esta prueba abre una CONEXIÓN POR INTENTO. Es la única forma de
# reproducir el defecto; dentro de un mismo bloque, el efecto desaparece y la
# prueba pasaría sin demostrar nada.
#
# Se crea su propia base y se deja: así no depende del estado de `limpia` ni
# lo ensucia, y se puede correr sola mientras otra cosa usa la base principal.
# =====================================================================
set -uo pipefail

SOCKET="${PG_SOCKET:-/data/data/com.termux/files/usr/var/run}"
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="${BASE_CANDADO:-candado}"
CLAVE="4321"

ok=0; fallas=0
t() { if [ "$1" = "1" ]; then ok=$((ok+1)); echo "  ok   $2"; else fallas=$((fallas+1)); echo "  FALLA $2"; fi; }

# Una consulta, su propia conexión. `-tA` deja el valor pelado.
q() { psql -h "$SOCKET" -U postgres -d "$BASE" -tA -c "$1" 2>&1 | head -1; }

if ! psql -h "$SOCKET" -U postgres -d postgres -q -c "select 1;" >/dev/null 2>&1; then
  echo "  Omitido: no hay Postgres en $SOCKET."
  exit 0
fi

# Base propia, desde cero: el punto de partida no se hereda.
psql -h "$SOCKET" -U postgres -d postgres -q \
  -c "drop database if exists $BASE;" -c "create database $BASE;" >/dev/null 2>&1
psql -h "$SOCKET" -U postgres -d "$BASE" -q -c "create schema if not exists extensions;" >/dev/null 2>&1
psql -h "$SOCKET" -U postgres -d "$BASE" -q -f "$RAIZ/supabase/tests/_supabase_shim.sql" >/dev/null 2>&1
for f in "$RAIZ"/supabase/migrations/*.sql; do
  psql -h "$SOCKET" -U postgres -d "$BASE" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 \
    || { echo "  FALLA no se pudo aplicar $(basename "$f")"; exit 1; }
done

echo "=== Candado de intentos (una conexión por intento) ==="

# 1. La primera clave se puede establecer, sin anterior.
q "select public.admin_change_key(null, '$CLAVE')" >/dev/null
t "$([ "$(q "select (public.admin_key_status()->>'configurada')")" = "true" ] && echo 1 || echo 0)" \
  "la primera clave se establece sin escribir una anterior"

# 2. Cinco intentos fallidos, cada uno en SU transacción.
for i in 1 2 3 4 5; do q "select public.admin_check_key('0000')" >/dev/null; done
intentos="$(q "select public.admin_intentos_fallidos()")"
t "$([ "$intentos" = "5" ] && echo 1 || echo 0)" \
  "cinco intentos fallidos quedan contados (conto $intentos)"

bloq="$(q "select public.admin_key_status()->>'bloqueada'")"
t "$([ "$bloq" = "true" ] && echo 1 || echo 0)" \
  "y el estado dice que está bloqueada"

# 3. Bloqueada, ni la clave correcta entra. Este es el punto del candado:
#    si solo frenara las equivocadas, no frenaría a quien está probando.
res="$(q "select public.admin_check_key('$CLAVE')")"
t "$(printf '%s' "$res" | rg -q 'clave_bloqueada' && echo 1 || echo 0)" \
  "bloqueada, ni la clave correcta entra"

# 4. Cumplida la espera, vuelve a entrar y el conteo arranca de cero.
#    Se envejece el último fallo en vez de esperar diez minutos.
q "select setval('public.admin_ultimo_fallo_seq', ((extract(epoch from clock_timestamp())*1000)::bigint - 660000))" >/dev/null
bloq="$(q "select public.admin_key_status()->>'bloqueada'")"
t "$([ "$bloq" = "false" ] && echo 1 || echo 0)" \
  "pasada la espera, deja de estar bloqueada"

res="$(q "select public.admin_check_key('$CLAVE')")"
t "$(printf '%s' "$res" | rg -q '"ok"' && echo 1 || echo 0)" \
  "y la clave correcta vuelve a entrar"

intentos="$(q "select public.admin_intentos_fallidos()")"
t "$([ "$intentos" = "0" ] && echo 1 || echo 0)" \
  "al acertar, el conteo vuelve a cero sin arrastrar los fallos viejos"

# 5. El defecto original, en su forma exacta: si el conteo viviera en una
#    tabla escrita antes del error, este bucle daría 0 para siempre.
for i in 1 2 3 4 5 6 7; do q "select public.admin_check_key('0000')" >/dev/null; done
intentos="$(q "select public.admin_intentos_fallidos()")"
t "$([ "$intentos" -ge 5 ] && echo 1 || echo 0)" \
  "tras 7 fallos el conteo no se borró solo (quedó en $intentos)"

psql -h "$SOCKET" -U postgres -d postgres -q -c "drop database if exists $BASE;" >/dev/null 2>&1

echo
if [ "$fallas" = "0" ]; then
  echo "  candado: $ok correctas, 0 fallas"
  exit 0
fi
echo "  candado: $ok correctas, $fallas fallas"
exit 1
