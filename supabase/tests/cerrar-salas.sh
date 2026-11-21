#!/usr/bin/env bash
# Corre `cerrar_salas.sql` y lo cuenta en el formato que `probar.sh` suma.
#
# POR QUE HACE FALTA ESTE ENVOLTORIO
# ----------------------------------
# `cerrar_salas.sql` existia, pasaba sus comprobaciones y NO la corria nadie:
# `probar.sh` solo llamaba a `smoke.sql` y a `candado.sh`. Ocho comprobaciones
# en verde que no contaban en ningun total, y un defecto podia entrar sin que
# nada se pusiera rojo. Es el mismo fallo que tener un modulo sin conectar.
#
# COMO SE DECIDE SI PASO
# ----------------------
# NO se cuentan renglones: `psql` agrega los `NOTICE`, el conteo final y el
# aviso de cada linea, y el numero cambia por motivos que no tienen que ver con
# el resultado. Se busca el marcador que el propio archivo escribe al final, y
# ademas se exige que no haya `FALLA` en ninguna parte.
#
# Las bases se crean y se tiran aqui: `cerrar_salas.sql` corre dentro de una
# transaccion con `rollback`, pero necesita sus propias salas y su propia clave.
set -uo pipefail

SOCKET="${SOCKET:-/data/data/com.termux/files/usr/var/run}"
BASE="${BASE:-limpia}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if ! psql -h "$SOCKET" -U postgres -d "$BASE" -q -c "select 1;" >/dev/null 2>&1; then
  echo "  cerrar-salas: omitido (sin Postgres en $SOCKET)"
  echo "  Para levantarlo: pg_ctl -D \"\$HOME/.cache/desafio-pg\" -l /dev/null -o \"-k $SOCKET\" -w start"
  echo "  Omitido: no se pudo probar"
  exit 0
fi

salida="$(psql -h "$SOCKET" -U postgres -d "$BASE" -q \
  -f "$RAIZ/supabase/tests/cerrar_salas.sql" 2>&1)"
codigo=$?

ok="$(printf '%s\n' "$salida" | grep -c 'NOTICE:  ok ' || true)"
fallas="$(printf '%s\n' "$salida" | grep -c 'FALLA' || true)"

# Una medicion vacia no es «0 problemas»: si no se ejecuto ninguna
# comprobacion, la prueba no paso, aunque no haya ningun FALLA.
if [ "$codigo" -eq 0 ] \
   && [ "$fallas" = "0" ] \
   && printf '%s\n' "$salida" | grep -q 'TODAS LAS PRUEBAS DE CERRAR SALAS PASARON' \
   && [ "$ok" -gt 0 ]; then
  echo "  cerrar-salas: $ok correctas, 0 fallas"
  exit 0
fi

echo "  cerrar-salas: $ok correctas, $((fallas > 0 ? fallas : 1)) fallas"
printf '%s\n' "$salida" | grep -E 'FALLA|ERROR' | head -6 | sed 's/^/      /'
[ "$ok" -gt 0 ] || echo "      no se ejecuto ninguna comprobacion"
exit 1
