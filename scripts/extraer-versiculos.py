#!/usr/bin/env python3
"""Extrae la fase 3 del cuestionario y genera la semilla SQL.

La fuente es el .docx, no una copia a mano: así el texto queda exactamente
como está en el documento, con sus faltas incluidas, y se puede volver a
generar si el documento cambia.

Uso:
    python3 scripts/extraer-versiculos.py /ruta/Cuestionario.docx > semilla.sql

Cada versículo sale con las palabras subrayadas del documento entre llaves,
que es la forma que guarda `questions.texto_marcado`. La primera llave de
cada versículo es el hueco que se juega.
"""

import re
import sys
import zipfile


def texto_de_parrafo(parrafo):
    """Devuelve el texto del párrafo marcando con llaves lo subrayado."""
    trozos = []
    for run in re.findall(r"<w:r[ >].*?</w:r>", parrafo, re.S):
        letras = re.findall(r"<w:t[^>]*>(.*?)</w:t>", run, re.S)
        if not letras:
            continue
        texto = "".join(letras)
        texto = (texto.replace("&amp;", "&")
                      .replace("&lt;", "<")
                      .replace("&gt;", ">")
                      .replace("&quot;", '"')
                      .replace("&apos;", "'"))
        if not texto:
            continue
        subrayado = "<w:u " in run or "<w:u/>" in run
        trozos.append(("U" if subrayado else "-", texto))
    return trozos


def unir_marcando(trozos):
    """Une los trozos y envuelve en llaves cada racha subrayada."""
    salida = []
    dentro = False
    for tipo, texto in trozos:
        if tipo == "U":
            if not dentro:
                salida.append("{")
                dentro = True
            salida.append(texto)
        else:
            if dentro:
                salida.append("}")
                dentro = False
            salida.append(texto)
    if dentro:
        salida.append("}")
    unido = "".join(salida)
    # Una llave vacía no es un hueco: se descarta.
    unido = re.sub(r"\{\s*\}", "", unido)
    # Los huecos que quedaron a medias se cierran.
    if unido.count("{") != unido.count("}"):
        unido = unido.replace("{", "").replace("}", "")
    return unido


def limpiar(texto):
    """Colapsa espacios sin tocar el contenido de las llaves."""
    partes = re.split(r"(\{[^{}]*\})", texto)
    limpias = []
    for i, parte in enumerate(partes):
        if i % 2 == 1:               # es un hueco: se respeta tal cual
            limpias.append(parte)
        else:
            limpias.append(re.sub(r"\s+", " ", parte))
    return "".join(limpias).strip()


def extraer(ruta_docx):
    with zipfile.ZipFile(ruta_docx) as z:
        xml = z.read("word/document.xml").decode("utf-8")
    parrafos = re.findall(r"<w:p[ >].*?</w:p>", xml, re.S)

    # Se arranca en la fase 3: lo anterior es fase 1 (preguntas) y fase 2.
    inicio = None
    for i, p in enumerate(parrafos):
        if "FASE 3" in "".join(re.findall(r"<w:t[^>]*>(.*?)</w:t>", p, re.S)):
            inicio = i
            break
    if inicio is None:
        raise SystemExit("no encontré la fase 3 en el documento")

    versiculos = []
    for p in parrafos[inicio + 1:]:
        texto = limpiar(unir_marcando(texto_de_parrafo(p)))
        if "{" not in texto:
            continue                      # sin subrayado no es un versículo
        referencia = re.search(r"\(?\s*2\s*Corintios\s*([0-9]+\s*[:.]\s*[0-9]+)\s*\)?",
                               texto, re.I)
        if not referencia:
            continue
        ref = re.sub(r"\s+", "", referencia.group(1)).replace(".", ":")
        huesos = re.findall(r"\{([^{}]*)\}", texto)
        versiculos.append({
            "ref": "2 Corintios " + ref,
            "marcado": texto,
            "huecos": huesos,
        })
    return versiculos


def escapar(texto):
    return texto.replace("'", "''")


def main():
    if len(sys.argv) != 2:
        raise SystemExit("uso: extraer-versiculos.py <archivo.docx>")
    versiculos = extraer(sys.argv[1])

    total_huecos = sum(len(v["huecos"]) for v in versiculos)
    print(f"-- {len(versiculos)} versículos, {total_huecos} huecos")
    print("-- Generado por scripts/extraer-versiculos.py. No editar a mano.")
    print()
    for v in versiculos:
        print("insert into public.questions")
        print("  (game_slug, topic_id, prompt, texto_marcado, reference, source)")
        print("values (")
        print("  'completar-versiculo',")
        print("  v_tema,")
        print(f"  public.versiculo_render('{escapar(v['marcado'])}', '{{}}'),")
        print(f"  '{escapar(v['marcado'])}',")
        print(f"  '{escapar(v['ref'])}',")
        print("  'seed'")
        print(");")
        print()


if __name__ == "__main__":
    main()
