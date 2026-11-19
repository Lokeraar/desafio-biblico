#!/usr/bin/env bash
# Aplica un archivo .sql al Supabase real por la API de administración.
#
# Por qué existe: la regla del proyecto pide un helper que recibe un
# archivo, toma el token del entorno, es idempotente y verifica el esquema
# después de aplicar. Un `curl` a mano no deja rastro de qué se aplicó ni
# comprueba que de verdad quedó.
#
# Uso:
#   export SUPABASE_ACCESS_TOKEN=...     # nunca en la línea del comando
#   bash scripts/aplicar-supabase.sh supabase/migrations/20261119000000_....sql
#   bash scripts/aplicar-supabase.sh --verificar
#
# Sale con 0 solo si la consulta fue aceptada.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ" || exit 1

REF="${SUPABASE_REF:-xodghdateldeobuumhyd}"
API="https://api.supabase.com/v1/projects/$REF/database/query"

TOKEN="${SUPABASE_ACCESS_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  echo "Falta SUPABASE_ACCESS_TOKEN en el entorno."
  echo
  echo "Consíguelo en https://supabase.com/dashboard/account/tokens"
  echo "Pásalo por el entorno, no en la línea del comando:"
  echo
  echo "  export SUPABASE_ACCESS_TOKEN='sbp_...'"
  echo
  echo "Al terminar la sesión, revócalo."
  exit 2
fi

enviar() {
  local archivo="$1"
  local respuesta
  respuesta=$(python3 -c 'import json,sys; print(json.dumps({"query": open(sys.argv[1]).read()}))' "$archivo" \
    | curl -sS -m 180 -X POST "$API" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        --data-binary @- 2>&1)
  local codigo=$?
  if [ $codigo -ne 0 ]; then
    echo "FALLA de red al enviar $(basename "$archivo")"
    echo "$respuesta"
    return 1
  fi
  # La API devuelve [] cuando la consulta salió bien (sin filas), y las
  # filas en JSON cuando las hay. Un `select` de verificación trae filas:
  # hay que imprimirlas, o el «ok» no dice nada.
  if printf '%s' "$respuesta" | grep -q '"message"'; then
    echo "FALLA al aplicar $(basename "$archivo"):"
    printf '%s\n' "$respuesta" | head -20
    return 1
  fi
  if [ "$respuesta" != "[]" ] && [ -n "$respuesta" ]; then
    printf '%s\n' "$respuesta" | python3 -c '
import json, sys
filas = json.load(sys.stdin)
if not isinstance(filas, list):
    print(filas); raise SystemExit
for f in filas:
    print("  " + " | ".join(f"{k}={v}" for k, v in f.items()))
' 2>/dev/null || printf '%s\n' "$respuesta"
  fi
  echo "  ok   $(basename "$archivo")"
  return 0
}

if [ "${1:-}" = "--verificar" ]; then
  echo "=== Estado del esquema en $REF ==="
  cat > .logs/verificar-esquema.sql <<'SQL'
select 'columna questions.texto_marcado' as pieza,
       count(*) as hay
  from information_schema.columns
 where table_schema = 'public' and table_name = 'questions'
   and column_name = 'texto_marcado'
union all
select 'valor juicio en rounds.state',
       count(*) from pg_constraint
 where conname = 'rounds_state_check'
   and pg_get_constraintdef(oid) like '%juicio%'
union all
select 'funcion player_pulsar',
       count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'player_pulsar'
union all
select 'funcion host_sentenciar',
       count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'host_sentenciar'
union all
select 'versiculos sembrados',
       count(*) from public.questions
 where game_slug = 'completar-versiculo'
union all
select 'tema 2 Corintios del juego nuevo',
       count(*) from public.topics
 where game_slug = 'completar-versiculo' and name = '2 Corintios'
union all
select 'preguntas de seleccion simple (deben ser 25)',
       count(*) from public.questions where game_slug = 'seleccion-simple';
SQL
  enviar .logs/verificar-esquema.sql
  exit $?
fi

if [ $# -ne 1 ]; then
  echo "uso: aplicar-supabase.sh <archivo.sql> | --verificar"
  exit 1
fi

if [ ! -f "$1" ]; then
  echo "no existe el archivo: $1"
  exit 1
fi

echo "=== Aplicando a Supabase ($REF) ==="
enviar "$1" || exit 1
echo
echo "Verifica el resultado con: bash scripts/aplicar-supabase.sh --verificar"
