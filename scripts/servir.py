#!/usr/bin/env python3
"""Servidor local del juego, sin caché.

Por qué no `python3 -m http.server`: ese manda `Last-Modified` y el
navegador guarda los módulos ES. El síntoma es confuso: se corrige
`src/app.js`, se recarga, y sigue ejecutándose el de antes, así que el
arreglo «no hace nada». Aquí se manda `no-store` en todo y lo que se ve
es siempre lo que hay en disco.

Se llama desde `scripts/servir.sh`, que además comprueba que responde.
"""
import http.server
import os
import socketserver
import sys

PUERTO = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class SinCache(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=RAIZ, **kwargs)

    def end_headers(self):
        self.send_header(
            'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, *args):
        # Sin ruido: el registro solo interesa cuando algo falla.
        pass


def main():
    socketserver.TCPServer.allow_reuse_address = True
    try:
        with socketserver.TCPServer(("0.0.0.0", PUERTO), SinCache) as httpd:
            print(f"sirviendo {RAIZ} en http://0.0.0.0:{PUERTO} (sin cache)")
            httpd.serve_forever()
    except OSError as e:
        if e.errno == 98:
            print(f"El puerto {PUERTO} ya está ocupado por otro proceso.")
            sys.exit(1)
        raise


if __name__ == '__main__':
    main()
