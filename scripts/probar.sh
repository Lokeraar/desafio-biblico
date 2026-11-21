#!/usr/bin/env bash
# =====================================================================
# Probar: todas las pruebas del proyecto en un solo paso.
# ---------------------------------------------------------------------
# Existe porque correr las ocho suites a mano —siete de JavaScript y una
# de SQL— era trabajo repetido en cada cambio, y con la salida repartida
# es fácil quedarse con la duda de si alguna falló.
#
# Uso:
#   bash scripts/probar.sh          # todo (si el Postgres está arriba, también SQL)
#   bash scripts/probar.sh --js     # solo JavaScript
#   bash scripts/probar.sh --sql    # solo SQL
#
# Sale con código 0 solo si TODO pasó.
# =====================================================================
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOCKET="${PG_SOCKET:-/data/data/com.termux/files/usr/var/run}"
BASE="${PG_BASE:-limpia}"

solo_js=false
solo_sql=false
case "${1:-}" in
  --js)  solo_js=true ;;
  --sql) solo_sql=true ;;
  "")    ;;
  *) echo "Opción desconocida: $1. Usa --js o --sql." >&2; exit 2 ;;
esac

TOTAL_OK=0
TOTAL_FALLAS=0
SUITES_FALLIDAS=()
SUITES_OMITIDAS=()

# --- Pruebas de JavaScript -------------------------------------------
if [ "$solo_sql" = false ]; then
  echo "=== Pruebas de JavaScript ==="
  # La lista se DESCUBRE, no se escribe a mano.
  #
  # Estaba escrita a mano y `liberar.test.mjs` no figuraba: la prueba existia,
  # pasaba, y NUNCA se ejecutaba. Un archivo nuevo quedaba invisible hasta que
  # alguien se acordara de agregarlo, y nada lo avisaba. Descubriendo, un
  # archivo nuevo se corre el mismo dia que se crea.
  for archivo in "$RAIZ"/src/lib/*.test.mjs; do
    suite="$(basename "$archivo" .test.mjs)"
    salida="$(node "$archivo" 2>&1)"
    codigo=$?
    resumen="$(printf '%s\n' "$salida" | rg -o '[0-9]+ correctas, [0-9]+ fallas' | tail -1)"
    if [ -z "$resumen" ]; then
      echo "  $suite: NO TERMINÓ (código $codigo)"
      printf '%s\n' "$salida" | tail -5 | sed 's/^/      /'
      SUITES_FALLIDAS+=("$suite")
      continue
    fi

    ok="${resumen%% correctas*}"
    fallas="$(printf '%s' "$resumen" | rg -o '[0-9]+ fallas' | rg -o '[0-9]+')"

    if [ "$fallas" != "0" ] || [ "$codigo" != "0" ]; then
      # La suite falló. Su conteo NO se suma al total bueno: resumir
      # «328 correctas, 0 fallas» cuando una suite falló era un subtotal
      # que mentía, y un resumen que miente es peor que no tenerlo. Las
      # que sí pasaron se cuentan; la que falló se nombra aparte.
      echo "  $suite: $resumen  <-- REVISAR (sale con código $codigo)"
      printf '%s\n' "$salida" | rg 'FALLA|✘' | head -10 | sed 's/^/      /'
      SUITES_FALLIDAS+=("$suite")
      TOTAL_FALLAS=$((TOTAL_FALLAS + 1))
    else
      echo "  $suite: $resumen"
      TOTAL_OK=$((TOTAL_OK + ok))
    fi
  done
  echo "  Subtotal JS: $TOTAL_OK correctas, $TOTAL_FALLAS suites con fallas"
fi

# --- Pruebas de SQL ---------------------------------------------------
if [ "$solo_js" = false ]; then
  echo
  echo "=== Pruebas de SQL ==="
  if ! psql -h "$SOCKET" -U postgres -d "$BASE" -q -c "select 1;" >/dev/null 2>&1; then
    # Sin base no se puede probar el SQL. No se marca como fallo: se dice
    # cómo levantarla, porque confundir «no probado» con «falló» hace
    # perseguir un error que no existe.
    #
    # Pero SÍ se anota como omitido y el veredicto deja de decir «TODO EN
    # VERDE»: un verde que no miró el SQL es un verde sobre nada.
    echo "  Omitido: no hay Postgres en $SOCKET (base '$BASE')."
    echo "  Para levantarlo:"
    echo "    pg_ctl -D \"\$HOME/.cache/desafio-pg\" -l /dev/null \\"
    echo "      -o \"-k $SOCKET\" -w start"
    echo "  Para crear la base desde cero: bash scripts/probar-sql-limpio.sh"
    SUITES_OMITIDAS+=("smoke (SQL)" "candado (SQL)")
  else
    salida="$(psql -h "$SOCKET" -U postgres -d "$BASE" -f "$RAIZ/supabase/tests/smoke.sql" 2>&1)"
    ok="$(printf '%s\n' "$salida" | rg -c "NOTICE:\s+ok " || echo 0)"
    if printf '%s\n' "$salida" | rg -q "TODAS LAS PRUEBAS PASARON"; then
      echo "  smoke: $ok correctas, 0 fallas"
      TOTAL_OK=$((TOTAL_OK + ok))
    else
      fallo="$(printf '%s\n' "$salida" | rg -m1 'FALLA:' | sed 's/.*FALLA:/  /')"
      echo "  smoke: FALLÓ${fallo:+ →$fallo}"
      printf '%s\n' "$salida" | rg 'ERROR|FALLA' | head -5 | sed 's/^/      /'
      TOTAL_FALLAS=$((TOTAL_FALLAS + 1))
      SUITES_FALLIDAS+=("smoke (SQL)")
    fi

    # El candado de intentos necesita una conexión POR INTENTO: dentro de una
    # sola transacción el defecto que lo rompía desaparece y la prueba pasaría
    # sin demostrar nada. Va aparte por eso, y se suma a mano porque su salida
    # no tiene la forma de `smoke.sql`.
    salida_candado="$(bash "$RAIZ/supabase/tests/candado.sh" 2>&1)"
    ok_candado="$(printf '%s\n' "$salida_candado" | rg -o 'candado: [0-9]+ correctas' | rg -o '[0-9]+' | tail -1)"
    if printf '%s\n' "$salida_candado" | rg -q 'candado: [0-9]+ correctas, 0 fallas'; then
      echo "  candado: ${ok_candado:-0} correctas, 0 fallas"
      TOTAL_OK=$((TOTAL_OK + ${ok_candado:-0}))
    elif printf '%s\n' "$salida_candado" | rg -q 'Omitido:'; then
      echo "  candado: omitido (sin Postgres)"
      SUITES_OMITIDAS+=("candado (SQL)")
    else
      echo "  candado: FALLÓ"
      printf '%s\n' "$salida_candado" | rg 'FALLA' | head -5 | sed 's/^/      /'
      TOTAL_FALLAS=$((TOTAL_FALLAS + 1))
      SUITES_FALLIDAS+=("candado (SQL)")
    fi
  fi
fi

# --- Veredicto --------------------------------------------------------
echo
echo "==============================================="
if [ ${#SUITES_FALLIDAS[@]} -ne 0 ]; then
  echo " HAY FALLAS en: ${SUITES_FALLIDAS[*]}"
  echo " Total: $TOTAL_OK correctas, $TOTAL_FALLAS fallas"
  echo "==============================================="
  exit 1
fi

# Un verde parcial NO es un verde. Sin esto, un Postgres caído daba
# «TODO EN VERDE» con 536 en vez de 694 y el número no lo delataba.
if [ ${#SUITES_OMITIDAS[@]} -ne 0 ]; then
  echo " INCOMPLETO: $TOTAL_OK correctas, y sin probar: ${SUITES_OMITIDAS[*]}"
  echo " No es un verde: eso no se ejecutó."
  echo "==============================================="
  exit 2
fi

echo " TODO EN VERDE: $TOTAL_OK correctas, 0 fallas"
echo "==============================================="
exit 0
