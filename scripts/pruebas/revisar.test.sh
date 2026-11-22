#!/usr/bin/env bash
# Prueba de `scripts/revisar.sh`: su contrato externo, el de verdad.
#
# QUE SE PROTEGE
# --------------
# El script existe para no volver a dar tres vueltas de revision. Su promesa
# es: decir el rango exacto, NEGARSE cuando hay cambios sin commitear (porque
# no entran en el rango), y correr `--probar` cuando se pide.
#
# Las tres cosas se rompieron al escribirlo:
#   · con cero commits sin publicar, `--probar` se lo comia un `exit` temprano;
#   · con el arbol sucio solo avisaba y salia 0, que es no negarse;
#   · sin guardas, un fallo de git dejaba el conteo vacio y seguia.
#
# Se prueban sobre un repositorio desechable, no sobre el real: tocar el arbol
# de trabajo de verdad para probar seria peligroso y lento.
set -uo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$AQUI/revisar.sh"
ok=0; fallas=0
t() { if [ "$1" = "0" ]; then ok=$((ok+1)); echo "  ok   $2"; else fallas=$((fallas+1)); echo "  FALLA $2"; fi; }
# El contrario: para los casos donde negarse ES lo correcto. Con `t` a secas,
# un script que se niega —que es lo que debe hacer— salia marcado como FALLA.
tf() { if [ "$1" != "0" ]; then ok=$((ok+1)); echo "  ok   $2"; else fallas=$((fallas+1)); echo "  FALLA $2"; fi; }

echo "=== revisar.sh: su contrato ==="

t "$([ -f "$SCRIPT" ] && echo 0 || echo 1)" "el script existe"

# Un repo desechable con su remoto falso, para controlar el rango a voluntad.
# NO en /tmp: en este aparato /tmp no existe y el proyecto tiene la regla de
# no usarlo nunca. Todo temporal va en .logs/.
mkdir -p "$AQUI/../.logs"
CAJA="$(mktemp -d "$AQUI/../.logs/revisar-prueba.XXXXXX")"
trap 'rm -rf "$CAJA"' EXIT

(cd "$CAJA" && git init -q --bare remoto.git) >/dev/null 2>&1
(cd "$CAJA" && git clone -q remoto.git trabajo) >/dev/null 2>&1
cd "$CAJA/trabajo" || exit 1
git config user.email p@ejemplo.com
git config user.name Prueba

# `revisar.sh` busca `scripts/probar.sh` para --probar. Se pone uno que deja
# marca, asi se comprueba que CORRIO y no solo que el script salio con 0.
mkdir -p scripts
cp "$SCRIPT" scripts/revisar.sh
cat > scripts/probar.sh <<'PROBAR'
#!/usr/bin/env bash
echo PROBAR_OK > /dev/null
exit 0
PROBAR
# CONTENIDO EXACTO DEL STUB, en una variable.
# Los casos lo reescriben. Para dejarlo limpio despues se vuelve a escribir
# ESTE MISMO texto: asi el archivo coincide con el commit y el arbol queda
# limpio sin borrar nada ni usar comandos destructivos. Antes se restauraba
# una version PARECIDA (sin la linea del echo) y por eso el arbol seguia sucio.
restaurar_stub() {
  cat > scripts/probar.sh <<'PROBAR'
#!/usr/bin/env bash
echo PROBAR_OK > /dev/null
exit 0
PROBAR
}

echo listo > archivo.txt
git add -A && git commit -qm "primero"
git branch -M main
git push -q origin main 2>/dev/null

# --- caso 2b: la rama DETRAS no es divergir (R3-002) ---
# Va PRIMERO, recien empujado: el arbol esta limpio y al dia. Mas adelante ya
# hay commits locales y el estado seria «divergido», que es otro caso. Ponerlo
# al final lo dejaba en «omitido», y un omitido se contaba como ok: otra prueba
# que no probaba nada.
git clone -q -b main "$CAJA/remoto.git" "$CAJA/otro" 2>/dev/null
(
  cd "$CAJA/otro" || exit 1
  git config user.email o@ejemplo.com
  git config user.name Otro
  echo ajeno >> archivo.txt
  git commit -qam "de otro"
  git push -q origin main
) 2>/dev/null
git fetch -q origin
if git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  bash scripts/revisar.sh >/dev/null 2>&1
  t "$?" "con la rama DETRAS: sale 0, no es un error"
  salida_detras="$(bash scripts/revisar.sh 2>&1)"
  t "$(printf '%s' "$salida_detras" | grep -q 'DETRAS' && echo 0 || echo 1)" \
    "y lo dice con la palabra DETRAS, no «divergieron»"
else
  fallas=$((fallas+1))
  echo "  FALLA no se pudo montar el escenario de rama detras"
fi
# R3-001 de la revision: DETRAS con el arbol SUCIO tiene que cortar.
# Esta rama era la unica de las tres salidas buenas que no miraba el arbol:
# decia «no hay nada que publicar» y salia con 0 aunque hubiera cambios sin
# commitear. Se comprueba aqui, que es cuando la rama esta de verdad detras.
echo sucio >> archivo.txt
bash scripts/revisar.sh >/dev/null 2>&1
tf "$?" "DETRAS con cambios sin commitear: sale 1, no dice que no hay nada"
salida_sucio="$(bash scripts/revisar.sh 2>&1)"
t "$(printf '%s' "$salida_sucio" | grep -q 'cambios sin commitear' && echo 0 || echo 1)" \
  "y lo dice con la palabra «cambios sin commitear»"
git update-ref refs/heads/main "$(git rev-parse HEAD)" 2>/dev/null
git stash -q 2>/dev/null || true
git stash drop -q 2>/dev/null || true

# Se vuelve al punto de partida para el caso 3.
git reset -q --hard origin/main

# --- caso 1: al dia, arbol limpio, sin --probar ---
bash scripts/revisar.sh >/dev/null 2>&1
t "$?" "al dia y limpio: sale 0"

# --- caso 2: al dia con --probar (el defecto R3-001) ---
salida_probar="$(bash scripts/revisar.sh --probar 2>&1)"
t "$?" "al dia con --probar: sale 0"
t "$(printf '%s' "$salida_probar" | grep -q 'Autoverificacion' && echo 0 || echo 1)" \
  "al dia con --probar: la verificacion SI corre"

# R3-001: si la verificacion deja archivos, el script tiene que negarse a
# mandar a revisar: ese cambio no esta en el rango.
cat > scripts/probar.sh <<'PROBAR'
#!/usr/bin/env bash
echo basura > "$(dirname "$0")/../.dejo-basura"
exit 0
PROBAR
bash scripts/revisar.sh --probar >/dev/null 2>&1
tf "$?" "si la verificacion deja archivos sueltos: sale 1"
rm -f .dejo-basura
restaurar_stub

# --- caso 3: un commit sin publicar, arbol limpio ---
echo dos >> archivo.txt
git commit -qam "segundo"
bash scripts/revisar.sh >/dev/null 2>&1
t "$?" "con un commit sin publicar: sale 0"

# --- caso 4: arbol sucio con commits sin publicar (el defecto R3-002) ---
echo sucio >> archivo.txt
bash scripts/revisar.sh >/dev/null 2>&1
tf "$?" "con cambios sin commitear: sale 1, se niega a revisar"
git checkout -q -- archivo.txt

# --- caso 5: arbol sucio y al dia ---
git push -q origin main 2>/dev/null
echo sucio >> archivo.txt
bash scripts/revisar.sh >/dev/null 2>&1
tf "$?" "al dia pero con cambios sin commitear: sale 1"
git checkout -q -- archivo.txt

# --- caso 5b: --probar en la ruta PRINCIPAL (con commits pendientes) ---
# La revision lo marco: el unico caso de --probar estaba en la rama «al dia»,
# que no es la ruta normal. Aqui se prueba donde de verdad se usa.
echo tres >> archivo.txt
git commit -qam "tercero"
salida_pend="$(bash scripts/revisar.sh --probar 2>&1)"
t "$?" "con commits pendientes y --probar: sale 0"
t "$(printf '%s' "$salida_pend" | grep -q 'Autoverificacion' && echo 0 || echo 1)" \
  "con commits pendientes y --probar: la verificacion corre"

# --- caso 5c: si la autoverificacion FALLA, revisar.sh corta ---
# Un `probar.sh` que falla no puede dejar pasar la revision como si nada.
# Y se COMMITEA el cambio: si queda suelto, el guardia de arbol sucio corta
# primero y este caso pasaria por el motivo equivocado. La revision lo marco:
# asi estaba, y el caso no probaba nada de lo que decia.
cat > scripts/probar.sh <<'PROBAR'
#!/usr/bin/env bash
echo "fallo a proposito"
exit 1
PROBAR
git add scripts/probar.sh && git commit -qm "probar.sh que falla"
bash scripts/revisar.sh --probar >/dev/null 2>&1
tf "$?" "si probar.sh falla: sale 1 y no manda a revisar"
# Se comprueba que corto POR LA RAZON correcta, no por otra casualidad.
salida_fallo="$(bash scripts/revisar.sh --probar 2>&1)"
t "$(printf '%s' "$salida_fallo" | grep -q 'La autoverificacion FALLO' && echo 0 || echo 1)" \
  "y corta diciendo que fallo la autoverificacion, no otra cosa"

# --- caso 5d: imprime la base y la cabeza exactas ---
cat > scripts/probar.sh <<'PROBAR'
#!/usr/bin/env bash
exit 0
PROBAR
git add scripts/probar.sh && git commit -qm "probar.sh que pasa"
salida="$(bash scripts/revisar.sh 2>&1)"
base_esperada="$(git rev-parse origin/main)"
cabeza_esperada="$(git rev-parse HEAD)"
t "$(printf '%s' "$salida" | grep -q "$base_esperada" && echo 0 || echo 1)" \
  "imprime la base exacta del rango"
t "$(printf '%s' "$salida" | grep -q "$cabeza_esperada" && echo 0 || echo 1)" \
  "imprime la cabeza exacta del rango"

# --- caso 6: sin remoto no puede saber el rango ---
git remote remove origin
bash scripts/revisar.sh >/dev/null 2>&1
tf "$?" "sin origin/main: sale 1 y no inventa un rango"

echo
if [ "$fallas" = "0" ]; then
  echo "  revisar: $ok correctas, 0 fallas"
  exit 0
fi
echo "  revisar: $ok correctas, $fallas fallas"
exit 1
