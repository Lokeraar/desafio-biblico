# 03 — Los 100 defectos de la revisión manual (2026-11-21)

Origen: revisión manual de Christian sobre el estado publicado en `ef3d105`.
Este archivo se perdió una vez por un fallo de `sdcardfs` (quedó a 0 bytes);
se reconstruyó de la lista que él dio.

## Regla de trabajo

- **P0 primero**: sin esto el juego no se puede jugar.
- Cada bloque se prueba y se commitea por separado.
- Si un defecto es de comportamiento, **primero la prueba que falla**.
- Lo que sea decisión de producto va a `ask_user_question`.

## Hallazgo que cambia el diagnóstico

Verificado con `curl` contra producción, no leído:

| Función | Estado real |
|---|---|
| `topic_list` | **Funciona**: 2 temas (2 Corintios 25 preguntas, Romanos 0) |
| `host_create_room` | **Funciona**: exige `p_topic`, `p_game_slug`, `p_round_seconds`. Devolvió la sala `X85BV` |
| `player_join` | **Funciona**: devolvió `player_id` y `player_token` con la sala `X85BV` |
| `room_state` | **Funciona**: devuelve la sala con su jugador dentro |
| `room_by_code` | `sala_inexistente` con código inventado, que es lo correcto |

**El backend está sano.** Los P0 son del frontend o del entorno del navegador.
No se debe seguir depurando Supabase: ahí no está el problema.

Segundo hallazgo: `app.js` publicado y local **diferían en 370 bytes** porque
los objetos de git se corrompieron en `sdcardfs`, no porque hubiera trabajo sin
subir.

---

## P0 — Bloqueantes (el juego no funciona)

| # | Defecto |
|---|---|
| 1 | Entrar como participante da error |
| 2 | Selección simple: «no veo dónde seleccionar temas» |
| 3 | Selección simple no tiene juego, solo se puede presentar |
| 13 | Invitado no carga: «Ups, no puedo cargar ahora» |
| 18 | Invitado no encuentra sala (`sala_inexistente`) |
| 23 | Invitado: «no hay conexión» al entrar |
| 39 | No se puede unir a partida: solo el globito gris |
| 60 | Celular: se queda en «entrando a partida» |

## P1 — Bugs serios (rompen el flujo)

| # | Defecto |
|---|---|
| 4 | Pelotita de selección simple no carga la partida |
| 7 | Enviar respuesta en selección simple no hace nada |
| 8 | Selección simple: la pelotita muestra la respuesta |
| 9 | Versículos se adelanta y destapa el turno |
| 10 | Versículos: botón Pulsar no funciona |
| 12 | El presentador no ve las preguntas que responden |
| 28 | Participante ve 0.0 y no la pregunta |
| 30 | Nombre no se ve; pregunta tapa la vista |
| 34 | Dos buzones de preguntas y respuestas |
| 35 | Turno salta sin pulsar |
| 36 | Palabras aparecen ocultas por defecto |
| 37 | No se sabe qué respondió el participante |
| 38 | Respuesta larga no se ve; botón «Pulsar» inactivo |
| 51 | Buzón activo no deja pulsar en sala (versículos) |

## P2 — Aspecto y usabilidad (los demás números)

Menú: 5, 6, 16, 17, 20, 21, 22, 24, 25, 40, 41, 42, 46, 55, 57, 70, 71, 78,
84, 94, 97, 98.
Presentador: 11, 14, 15, 27, 29, 43, 44, 45, 47, 48, 49, 50, 53, 54, 56, 79,
80, 81, 82, 83, 88, 89, 91, 92, 95, 100.
Participante: 26, 31, 32, 33, 61-69, 72, 96.
Ceremonia y otros: 3, 19, 52, 73, 74, 75, 76, 77, 85, 86, 87, 90, 93, 99.

Cada uno con su descripción está en el mensaje de Christian del 2026-11-21.

## Orden de ataque

1. **P0**, empezando por el 1 y el 39 (entrar). Sin eso no se puede probar el
   resto.
2. **P1**: primero 12/28/30/34/37/38 (el presentador no ve lo que responden),
   después 9/35/36 (los versículos se destapan solos).
3. **P2 por pantalla**: presentador → participante → menú → ceremonia.
4. **P3**: estilo y pulido.

## Pruebas que faltan

`src/app.js` no tiene suite, y los P1 son justo comportamiento que vive ahí.
Hay que sacar la lógica a módulos puros como se hizo con `liberar.js`:
qué pregunta se muestra, quién puede pulsar, qué se destapa y cuándo, y qué ve
el presentador de lo que respondió cada uno.
