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
echo "probar.sh ejecutado" > "$(dirname "$0")/../.probar-corrio"
exit 0
PROBAR

echo listo > archivo.txt
git add -A && git commit -qm "primero"
git branch -M main
git push -q origin main 2>/dev/null

# --- caso 1: al dia, arbol limpio, sin --probar ---
bash scripts/revisar.sh >/dev/null 2>&1
t "$?" "al dia y limpio: sale 0"

# --- caso 2: al dia con --probar (el defecto R3-001) ---
rm -f .probar-corrio
bash scripts/revisar.sh --probar >/dev/null 2>&1
t "$?" "al dia con --probar: sale 0"
t "$([ -f .probar-corrio ] && echo 0 || echo 1)" "al dia con --probar: la verificacion SI corre"
# La marca que deja probar.sh es un archivo NUEVO en el arbol. Si no se limpia,
# ensucia el repo de prueba y los casos siguientes fallan por un motivo que no
# tiene que ver con lo que estan midiendo. Paso de verdad: asi se rompio.
rm -f .probar-corrio

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
rm -f .probar-corrio
bash scripts/revisar.sh --probar >/dev/null 2>&1
t "$?" "con commits pendientes y --probar: sale 0"
t "$([ -f .probar-corrio ] && echo 0 || echo 1)" "con commits pendientes y --probar: la verificacion corre"
rm -f .probar-corrio

# --- caso 5c: si la autoverificacion FALLA, revisar.sh corta ---
# Un `probar.sh` que falla no puede dejar pasar la revision como si nada.
cat > scripts/probar.sh <<'PROBAR'
#!/usr/bin/env bash
echo "fallo a proposito"
exit 1
PROBAR
bash scripts/revisar.sh --probar >/dev/null 2>&1
tf "$?" "si probar.sh falla: sale 1 y no manda a revisar"

# --- caso 5d: imprime la base y la cabeza exactas ---
cat > scripts/probar.sh <<'PROBAR'
#!/usr/bin/env bash
exit 0
PROBAR
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
