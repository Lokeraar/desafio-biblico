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

# --- Pruebas de JavaScript -------------------------------------------
if [ "$solo_sql" = false ]; then
  echo "=== Pruebas de JavaScript ==="
  for suite in engine local partida cloud render qr admin-ui; do
    archivo="$RAIZ/src/lib/$suite.test.mjs"
    if [ ! -f "$archivo" ]; then
      echo "  FALTA $archivo"
      SUITES_FALLIDAS+=("$suite (no existe)")
      continue
    fi

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
    echo "  Omitido: no hay Postgres en $SOCKET (base '$BASE')."
    echo "  Para levantarlo:"
    echo "    pg_ctl -D \"\$HOME/.cache/desafio-pg\" -l /dev/null \\"
    echo "      -o \"-k $SOCKET\" -w start"
    echo "  Para crear la base desde cero, mira AGENTS.md."
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
  fi
fi

# --- Veredicto --------------------------------------------------------
echo
echo "==============================================="
if [ ${#SUITES_FALLIDAS[@]} -eq 0 ]; then
  echo " TODO EN VERDE: $TOTAL_OK correctas, 0 fallas"
  echo "==============================================="
  exit 0
fi
echo " HAY FALLAS en: ${SUITES_FALLIDAS[*]}"
echo " Total: $TOTAL_OK correctas, $TOTAL_FALLAS fallas"
echo "==============================================="
exit 1
