#!/usr/bin/env bash
# Reconstruye la base `limpia` desde cero y aplica TODAS las migraciones.
#
# Por qué existe: `probar.sh --sql` corre smoke.sql contra la base tal como
# está. Si acabas de escribir una migración y no la aplicaste, las pruebas
# corren contra el esquema viejo y dan verde sobre código que no es el tuyo.
#
# Sale con código 0 solo si todas las migraciones se aplicaron.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOCKET="${PG_SOCKET:-/data/data/com.termux/files/usr/var/run}"
BASE="${PG_BASE:-limpia}"

cd "$RAIZ" || exit 1

if ! psql -h "$SOCKET" -U postgres -d postgres -q -c "select 1;" >/dev/null 2>&1; then
  echo "No hay Postgres en $SOCKET."
  echo "Levántalo con:"
  echo "  pg_ctl -D \"\$HOME/.cache/desafio-pg\" -l /dev/null \\"
  echo "    -o \"-k $SOCKET\" -w start"
  exit 1
fi

drop_base() {
  local out
  # Con conexiones abiertas, Postgres no deja borrar: hay que echarlas.
  if ! out=$(psql -h "$SOCKET" -U postgres -d postgres -q \
       -c "drop database if exists $BASE with (force);" 2>&1); then
    echo "FALLA al borrar la base $BASE:"
    printf '%s\n' "$out" | head -10
    return 1
  fi
  return 0
}

if ! drop_base; then
  echo "Cierra las conexiones abiertas a $BASE y vuelve a intentar."
  exit 1
fi

if ! psql -h "$SOCKET" -U postgres -d postgres -q -c "create database $BASE;" 2>&1; then
  echo "FALLA: no pude crear la base $BASE"
  exit 1
fi

P="psql -h $SOCKET -U postgres -d $BASE -q -v ON_ERROR_STOP=1"

$P -c "create schema if not exists extensions;" || { echo "FALLA: esquema extensions"; exit 1; }
$P -f supabase/tests/_supabase_shim.sql >/dev/null || { echo "FALLA: shim"; exit 1; }

for f in supabase/migrations/*.sql; do
  if ! salida="$($P -f "$f" 2>&1)"; then
    echo "FALLA en $(basename "$f"):"
    printf '%s\n' "$salida" | grep -v "^NOTICE" | head -30
    exit 1
  fi
  echo "  ok   $(basename "$f")"
done

echo "Esquema listo. Ahora: bash scripts/probar.sh --sql"
