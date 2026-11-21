# 01 — Comentarios del canvas aplicados

Origen: 19 comentarios de `gentle_design` en `design/completo` + 12 decisiones de
Christian del 2026-11-21 04:50.

## T1 — Ronda: versículo llena su caja

- [x] El versículo abarca todo el alto bajo la referencia (`flex: 1`, centrado).
- [x] Referencia a 16 pt (`1.3333rem`) en participante V, H y televisor.
- [x] Barra de temporizador junto al número, en participante V y H y en el televisor.

## T2 — Ronda: el botón de pulsar

- [x] Círculo lo más grande que quepa, a un espacio del marco (`aspect-ratio: 1/1`).
- [x] Texto a 1 fila que se ajusta a su ancho real.
- [x] Color atenuado (radial translúcido + borde), idéntico en vertical y acostado.
- [x] Bloqueado: dice el nombre de quien tiene el turno y se queda visible (decisión de Christian).

## T3 — Televisor: no es un concursante

- [x] «Salir de esta partida» arriba a la izquierda, en lugar del nombre del jugador.
- [x] QR encima del código.
- [x] «Participantes entrantes:» debajo del código, con los nombres a lo ancho.
- [x] El texto crece hasta el pie sin aire muerto.

## T4 — Menú

- [x] Botones centrados en su contenedor.
- [x] Letterboxing transparente: tarjeta con borde, se ve el fondo del menú.
- [x] «Sin modo local» pasa a «Sin conexión».
- [x] Sin conexión muestra lo que hay guardado (juegos, temas, preguntas, versículos).
- [x] «Tu sala sigue abierta» reintenta de verdad, no solo pide recargar.

## T5 — Entrar a la partida

- [x] Código editable cuando vino por QR (decisión: no se bloquea).
- [x] «La partida ya comenzó» queda pendiente para después.

## T6 — Sala de espera

- [x] «Este es tu nombre/alias en esta partida» en las tres apariciones.
- [x] Vertical: orbe animado al pie, después de la lista de participantes.
- [x] Acostado: orbe al pie de la columna izquierda; derecha solo participantes.
- [x] Hero a la derecha: «Juego:» + nombre del juego, en las dos orientaciones.
- [x] Orden de llegada, sin cambio.
- [x] «Conectando…» dice con qué conecta; «← Menú» es la salida, no hace falta cancelar aparte.
- [x] Estados: vacío con código y orbe; errores repartidos uno por placa; sin orbe solo en «la sala ya cerró».

## Lo que NO se toca

- «Respuesta abierta»: fuera de alcance por decisión de Christian.
- Estados «parcial» y «éxito-vacío»: solo trazo, sin contenido.
- Historial de partidas: para después.

## Verificación

- [ ] Los cinco artboards cierran y tienen los divs balanceados.
- [ ] `design.json` es JSON válido y lista los cinco.
- [ ] Los 19 comentarios quedan resueltos con nota.

---

# 02 — Pantallas que faltan en el canvas

Orden acordado con Christian el 2026-11-21.

## T1 — Panel del presentador (el bloque más grande)
Momentos reales, del marcado de `src/app.js`:
- [ ] Configuración: tema, preguntas, segundos, «Crear sala»
- [ ] Lobby: QR + código, lista de participantes, «Empezar»
- [ ] Ronda abierta: versículo con huecos, turno, reloj, pausar/terminar
- [ ] Juicio: sentenciar-bien / sentenciar-mal
- [ ] En pausa: «Reanudar»
- [ ] Sala cerrada

Acciones reales: abrir, iniciar, pausar, reanudar, saltar, revelar,
sentenciar-bien, sentenciar-mal, pedir-terminar, repetir, admitir, expulsar,
cerrar-pulsaciones.

## T2 — Ceremonia
Tabla de clasificación con podio escalonado, revelado por turnos,
«Nueva partida» y «Terminar juego». Presentador y televisor juntos.

## T3 — Los nueve modales
clave · cambiar clave · procesando · temas · preguntas · formularios ·
versículos · editor de versículo · juicio.

## T4 — Configuraciones y sala cerrada

## Fuera de alcance, por decisión de Christian
- «Respuesta abierta»
- Estados «parcial» y «éxito-vacío»
- Historial de partidas
