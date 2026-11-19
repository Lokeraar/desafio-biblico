#!/usr/bin/env python3
"""Sustituye un patrón en la migración. Lo usa probar-adversarial.sh.

Uso: _inyectar.py "viejo|||nuevo"

Sale con 1 si el patrón no aparece. Sin patrón no hay inyección, y una
inyección que no se aplicó no prueba nada: es la forma en que una prueba
«pasa» sin haber mirado nada.
"""
import sys

MIG = 'supabase/migrations/20261119000000_completar_versiculo.sql'


def main():
    if len(sys.argv) != 2:
        print('uso: _inyectar.py "viejo|||nuevo"', file=sys.stderr)
        return 2

    if '|||' not in sys.argv[1]:
        print('el argumento necesita el separador |||', file=sys.stderr)
        return 2

    viejo, nuevo = sys.argv[1].split('|||', 1)

    with open(MIG, encoding='utf-8') as f:
        s = f.read()

    if not viejo:
        print('el patrón viejo está vacío', file=sys.stderr)
        return 2

    veces = s.count(viejo)
    if veces == 0:
        print('NO_SE_ENCONTRO', file=sys.stderr)
        return 1
    if veces > 1:
        print('PATRON_AMBIGUO: aparece %d veces' % veces, file=sys.stderr)
        return 2

    with open(MIG, 'w', encoding='utf-8') as f:
        f.write(s.replace(viejo, nuevo, 1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
