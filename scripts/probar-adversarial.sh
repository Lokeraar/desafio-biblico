#!/usr/bin/env bash
# Inyecta defectos uno por uno y comprueba que la suite FALLA con cada uno.
#
# Por qué existe: una prueba que da verde con el defecto vivo no protege
# nada, y además quita la atención de donde está el problema. El verde dice
# «esto está cubierto» y se sigue de largo.
#
# Si alguna inyección sobrevive en verde, este script sale con 1.
# Si no puede aplicar la migración, también sale con 1: «no probado» no es
# «pasó». Ese fue justo el defecto de la primera versión de este script:
# contaba «no pude aplicar» como «detectado».
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ" || exit 1

MIG=supabase/migrations/20261119000000_completar_versiculo.sql
BAK=.logs/mig.bak

mkdir -p .logs
cp "$MIG" "$BAK" || { echo "no pude respaldar la migración"; exit 1; }

restaurar() {
  cp "$BAK" "$MIG"
}
trap restaurar EXIT

# probar <descripción> <viejo|||nuevo>
probar() {
  local nombre="$1"
  local patron="$2"

  if ! python3 scripts/_inyectar.py "$patron"; then
    echo "  ERROR     $nombre"
    echo "            el patrón del defecto no aparece en la migración:"
    echo "            la prueba no se ejecutó, y eso no es un pase."
    restaurar
    return 1
  fi

  if ! bash scripts/probar-sql-limpio.sh >.logs/inyeccion-aplicar.log 2>&1; then
    echo "  ERROR     $nombre"
    echo "            no se pudo aplicar la migración con el defecto;"
    echo "            sin esquema no hay prueba. Ver .logs/inyeccion-aplicar.log"
    restaurar
    return 1
  fi

  local out
  out=$(bash scripts/probar.sh --sql 2>&1)

  if printf '%s' "$out" | grep -q "TODO EN VERDE"; then
    echo "  NO PROTEGE   $nombre"
    echo "               la suite da VERDE con el defecto vivo"
    restaurar
    return 1
  fi

  local cual
  cual=$(printf '%s' "$out" | grep -o "FALLA: [^']*" | head -1 | sed 's/FALLA: //')
  echo "  detecta   $nombre"
  echo "            -> ${cual:-falló sin mensaje}"
  restaurar
  return 0
}

fallos=0
echo "=== Inyección de defectos sobre el juego nuevo ==="
echo

probar "la respuesta se filtra antes de revelar" \
"        -- LA REGLA
        'respuesta', case when v_round.state = 'revealed'|||        -- LA REGLA
        'respuesta', case when true" || fallos=$((fallos+1))

probar "el turno no pasa al siguiente" \
"update public.rounds set turno_answer_id = v_siguiente
       where id = v_round.id;|||null;" || fallos=$((fallos+1))

probar "el reparto de puntos pierde el sobrante" \
"+ case when r.rn <= (v_cupo - (select suma from tope))
                         then 1 else 0 end|||+ 0" || fallos=$((fallos+1))

probar "deshacer no devuelve los puntos" \
"update public.answers set puntos = 0 where round_id = v_round.id;|||null;" || fallos=$((fallos+1))

probar "el presentador no ve la respuesta" \
"                       'respuesta', public.versiculo_render(
                         v_q.texto_marcado,
                         array(select (h->>'indice')::int
                                 from jsonb_array_elements(
                                   public.versiculo_huecos(v_q.texto_marcado)) h))|||                       'respuesta', null::text" || fallos=$((fallos+1))

probar "el cierre no destapa los huecos que faltan" \
"     set huecos_revelados = to_jsonb(v_todos),|||     set huecos_revelados = v_round.huecos_revelados," || fallos=$((fallos+1))

echo
if [ "$fallos" -eq 0 ]; then
  echo "TODAS LAS INYECCIONES FUERON DETECTADAS"
  exit 0
fi
echo "HAY $fallos PROBLEMA(S): alguna prueba no protege lo que dice proteger"
exit 1
