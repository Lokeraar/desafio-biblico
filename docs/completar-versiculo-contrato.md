# Contrato de datos — Completar el versículo

**Congelado el 19/11/2026.** La interfaz y la base de datos se construyen
contra este documento. Si algo de aquí cambia, se cambia aquí primero y se
avisa, porque hay pantallas escritas contra cada campo.

Regla que manda sobre todas: **lo que no está aquí no existe para la
interfaz.** Ninguna pantalla lee una tabla directamente ni adivina un campo.

---

## 1. Por qué hay un contrato

El proyecto depende de que el servidor decida y el cliente solo imprima. Hoy
`room_state` y `host_state` son la única puerta, y las tres pantallas leen la
misma forma. Si la interfaz se escribiera antes de fijar esa forma, la base
llegaría después a cambiarla y habría que rehacer las pantallas.

Se congela entonces la forma primero, y cada capa se construye contra ella.

---

## 2. Lo que ya existe y NO se toca

Estos campos siguen viajando igual, con el mismo nombre y el mismo tipo. La
interfaz de selección simple los usa y no se entera de nada.

```jsonc
// room_state(p_room) — raíz
{
  "room_id": "uuid", "code": "ABC123", "game_slug": "completar-versiculo",
  "status": "lobby|question|reveal|ceremony|closed",
  "paused": false, "round_seconds": 15, "close_reason": null,
  "players": [{ "id", "name", "score", "total_ms", "correct",
                "joined_at", "waiting" }],
  "round": { /* ver §3 */ }
}
```

```jsonc
// host_state(p_room, p_token) = room_state + estos tres
{
  "host_channel": "uuid",
  "plan_remaining": 12,     // versículos sin usar en el plan
  "question_total": 29      // versículos del tema
}
```

`players` viene ordenado por marcador: `score desc, total_ms asc, joined_at asc`.
El orden lo decide el servidor, no el cliente.

---

## 3. `round` — la forma para todos

Campos comunes, idénticos en ambos juegos:

| Campo | Tipo | Cuándo llega |
|---|---|---|
| `round_id` | uuid | siempre |
| `ordinal` | int | siempre |
| `state` | texto | siempre |
| `prompt` | texto | siempre |
| `reference` | texto o null | siempre |
| `options` | array | `[]` en este juego; las 4 barajadas en selección simple |
| `opened_at` | ISO o null | siempre |
| `deadline` | ISO | siempre |
| `answered` | int | siempre |
| `no_winner` | bool | siempre |
| `winner_id` | uuid o null | siempre |
| `winner_name` | texto o null | siempre |
| `correct_key` | `"a"`–`"d"` o null | solo `seleccion-simple`, solo al revelar |
| `answers` | array | solo al revelar |

**`prompt` es el texto que se imprime, ya listo.** En este juego lo escribe el
servidor en cada lectura: los huecos ya revelados van rellenos y los que
faltan van como `____`. Por eso la tele y el teléfono no cambian su código
para dibujar el versículo.

Bloque nuevo, presente **solo** cuando `game_slug = 'completar-versiculo'`:

```jsonc
"versiculo": {
  "huecos_totales": 3,
  "revelados": [0, 2],          // índices ya destapados
  "completo": false,
  "respuesta": null,            // SOLO si state='revealed': texto con todo
  "contestando": null,          // o { "nombre": "Ana", "orden": 2 }
  "pulsos": [                   // ordenados por seq ascendente
    { "orden": 1, "player_id": "uuid", "nombre": "Beto", "veredicto": "incorrecto" },
    { "orden": 2, "player_id": "uuid", "nombre": "Ana",  "veredicto": "parcial" }
  ]
}
```

### La regla que no se negocia

**`respuesta` es null mientras `state <> 'revealed'`.** Es la misma regla que
hoy protege `correct_key`: el hueco no puede escaparse antes de que el
presentador lo sentencie. Hay una prueba de SQL dedicada a esto (§8).

### Por qué `pulsos` es público

Porque el juego lo dice en voz alta. El presentador anuncia el orden y la tele
muestra "fue la 2 en pulsar". El jugador necesita su propio número y no tiene
manera de calcularlo sin ver la lista completa. `player_id` ya es público en
`players[]`, así que no se filtra nada nuevo.

### Por qué no hay `huecos_ganados` aquí

Porque diría cuál hueco es correcto antes de destaparlo. En el momento en que
se gana un hueco, ese hueco se destapa en todas las pantallas: lo que se
sabe y lo que se ve van siempre juntos.

---

## 4. `round` — la forma solo para el presentador

`host_state` añade estos tres campos y **siempre** trae `versiculo.respuesta`
y los huecos completos, igual que hoy trae `correct_key` siempre.

```jsonc
"huecos": [                     // orden del texto, de izquierda a derecha
  { "indice": 0, "respuesta": "carta",     "revelado": true,
    "gano_player_id": "uuid", "gano_nombre": "Ana" },
  { "indice": 1, "respuesta": "corazones", "revelado": false,
    "gano_player_id": null,   "gano_nombre": null }
],
"turno_answer_id": "uuid",      // a quién le toca ahora, o null
"pulsos": [                     // reemplaza a "versiculo.pulsos" y lo amplía
  { "seq": 4471, "orden": 1, "player_id": "uuid", "nombre": "Beto",
    "veredicto": null,          // null | parcial | correcto | incorrecto
    "huecos_ganados": [] }
]
```

`host_state` también trae `round.answers[]` como hoy, con `option: null` en
este juego.

### Máquina de estados

```
prepared ──host_iniciar──▶ open ──cerrar pulsaciones──▶ juicio
                             │                            │
                             │                    ┌───────┴───────┐
                             │                 parcial        correcto
                             │                    │              │
                             │              (siguiente)    (se retira)
                             │                    │              │
                             ├────────────────────┴──────────────┘
                             │
                             ▼
                    closed  ◀── todos sentenciados / nadie pulsó / cierre manual
                        │
                        ▼
                    revealed
```

`rounds.state` gana el valor **`juicio`**. Ampliar el `CHECK` exige recrearlo
en la migración; es el punto más delicado de la entrega 1.

`juicio` se cierra por: (a) ventana agotada, (b) todos pulsaron, (c) el
presentador pulsó **Cerrar pulsaciones**.

`juicio` pasa a `closed` cuando: no queda ningún hueco tapado, o no queda
ningún pulso sin sentenciar, o el presentador pulsa **Cerrar pregunta**.

`closed` pasa a `revealed` siempre con todos los huecos a la vista.

---

## 5. RPC públicas nuevas

Todas `security definer`, `set search_path = public, pg_temp`, con `grant
execute` a `anon, authenticated`.

### `player_pulsar(p_player uuid, p_token text, p_round uuid)`

Pulsa el botón negro. Devuelve:

```jsonc
{ "seq": 4471, "orden": 2, "pulsos_totales": 3 }
```

Errores: `no_autorizado`, `jugador_expulsado`, `jugador_en_espera`,
`ronda_no_existe`, `ronda_cerrada`, `juego_pausado`, `fuera_de_tiempo`,
`ya_pulso`.

El `seq` sale de `answers.seq bigserial` bajo el `for update` sobre la ronda:
la misma pieza que ya usa `player_answer`. **No se inventa otra secuencia.**

### `host_cerrar_pulsaciones(p_room uuid, p_token text)`

`open → juicio`. Si nadie pulsó, salta a `closed` con `no_winner = true` y
revela los huecos. Idempotente: llamarla dos veces no rompe nada.

### `host_sentenciar(p_room uuid, p_token text, p_answer uuid, p_correcto boolean, p_huecos int[])`

Juzga al que tiene el turno.

- `p_correcto = false` → `veredicto = 'incorrecto'`. `p_huecos` se ignora.
- `p_correcto = true` → destapa los huecos de `p_huecos`, los anota en
  `huecos_ganados`, y `veredicto` queda `parcial` si falta alguno tapado o
  `correcto` si no queda ninguno.
- Si el `p_answer` no es el turno actual: error `no_es_el_turno`.
- Si un índice de `p_huecos` ya estaba revelado: error `hueco_ya_revelado`.
- Si `p_correcto` y `p_huecos` viene vacío: error `sin_huecos`.

### `host_deshacer_sentencia(p_room uuid, p_token text)`

Deshace **la última sentencia completa**, no el último toque. Retira los
huecos que esa sentencia había destapado, devuelve el turno a ese pulso, y
borra el `veredicto`. Error `nada_que_deshacer` si no hay nada.

### `host_cerrar_pregunta(p_room uuid, p_token text)`

Termina la ronda aunque queden huecos tapados: destapa los que faltan,
`no_winner = true` si nadie ganó nada, `juicio → closed → revealed`.
Es el camino de salida cuando el presentador cierra el panel a mitad de
ronda, o cuando algo salió mal en escena.

### `host_reabrir_pulsaciones(p_room uuid, p_token text)`

Vuelve `juicio → open` con la lista limpia, **conservando** los huecos ya
revelados. Solo puede usarse si ningún pulso llegó a ser sentenciado. Error
`ya_hay_juicios`.

---

## 6. Puntos

El versículo vale **10 puntos en total**, repartidos por huecos acertados.
Se otorgan **al cerrar la ronda**, nunca al sentenciar: así el marcador no
depende del orden de los juicios y un deshacer no deja puntos sueltos.

```
N   = huecos_totales
K_p = huecos ganados por el participante p
S   = Σ K_p          (con la garantía S ≤ N: un hueco se gana una sola vez)

S = 0                     → nadie suma, no_winner = true
cupo = floor(10 × S / N)  → total a repartir, nunca más de 10
base_p = floor(cupo × K_p / S)
resto_p = (cupo × K_p) mod S
sobrante = cupo − Σ base_p
```

El `sobrante` se reparte entre los mayores `resto_p`, y en empate gana el
`seq` más bajo (pulsó antes). Así la suma **nunca** pasa del cupo, nunca pasa
de 10, y nunca queda un punto sin asignar.

Tabla verificada con los 714 repartos válidos de N entre 1 y 9 con hasta tres
participantes: cero violaciones de las tres propiedades (suma ≤ cupo,
suma ≤ 10, y cero puntos cuando hubo aciertos).

| N | Reparto de huecos | Puntos |
|---|---|---|
| 3 | Ana 3 | Ana 10 |
| 3 | Ana 2, Beto 1 | Ana 7, Beto 3 |
| 3 | Ana 1, Beto 1, Caro 1 | Ana 4, Beto 3, Caro 3 |
| 3 | Ana 2, nadie más | Ana 6 |
| 4 | Ana 2, Beto 2 | Ana 5, Beto 5 |
| 4 | Ana 3, Beto 1 | Ana 8, Beto 2 |
| 4 | Ana 1, Beto 1, Caro 1 | Ana 3, Beto 2, Caro 2 |
| 4 | Ana 1, nadie más | Ana 2 |

`rounds.winner_player_id` queda **null**: la ronda la gana el versículo, no
una persona.

---

## 7. Lo que ve cada pantalla, campo por campo

| Pantalla | Lee | Nunca lee |
|---|---|---|
| Participante | `prompt`, `state`, `versiculo.revelados`, `versiculo.pulsos`, `versiculo.contestando`, `players[].score` (solo el propio) | `versiculo.respuesta`, `huecos`, `turno_answer_id` |
| Televisor | `prompt`, `state`, `versiculo.revelados`, `versiculo.contestando`, `players[].name` | `versiculo.respuesta`, `huecos`, `score` |
| Presentador | todo, incluidos `huecos[]`, `versiculo.respuesta`, `turno_answer_id` | — |

El puntaje propio del participante **no** sale de un campo nuevo: ya está en
`players[]` porque `room_state` lista a todos. El cliente busca el suyo por
`player_id`. No hace falta ampliar nada.

---

## 8. Pruebas que nacen con el contrato

Estas se escriben **antes** que el código, y cada una se verifica metiendo el
defecto a propósito y comprobando que falla.

### SQL (`supabase/tests/smoke.sql`, sección nueva)

1. **Fuga de respuesta.** Con `state = 'juicio'`, `room_state` devuelve
   `versiculo.respuesta = null` y ningún campo de `huecos`.
2. **Fuga de hueco.** Con `state = 'open'` y con `state = 'juicio'`,
   `versiculo.revelados` solo contiene índices ya destapados; `prompt` no
   contiene ninguna respuesta oculta.
3. **`prompt` bien armado.** Con 3 huecos y el 0 revelado, `prompt` tiene la
   respuesta 0 en el texto y dos `____`.
4. **El presentador sí ve.** `host_state` en `juicio` trae
   `versiculo.respuesta` y los tres `huecos` con su `respuesta`.
5. **Orden monotónico.** Tres pulsos seguidos dan `orden` 1, 2, 3 en el orden
   de llamada, y `seq` estrictamente creciente.
6. **Pulsar dos veces.** El segundo `player_pulsar` del mismo jugador falla
   con `ya_pulso`.
7. **Fuera de tiempo.** Pulsar con la ventana vencida falla
   `fuera_de_tiempo`.
8. **Sentenciar fuera de turno.** `host_sentenciar` sobre un pulso que no es
   el turno falla `no_es_el_turno`.
9. **Hueco ya revelado.** Sentenciar un índice que ya estaba destapado falla
   `hueco_ya_revelado`.
10. **Reparto proporcional.** Con N=3 y huecos 2/1, los puntos quedan 7 y 3.
11. **Nada pasa de 10.** En cualquier reparto, la suma de puntos otorgados en
    la ronda es ≤ 10.
12. **Nadie acertó.** Todos `incorrecto` → `no_winner = true` y cero puntos.
13. **Cierre sin ganador.** `host_cerrar_pregunta` con huecos tapados los
    destapa, conserva los puntos ya ganados y no reparte nuevos.
14. **Deshacer devuelve el turno.** Tras `host_deshacer_sentencia`, el
    `turno_answer_id` vuelve al anterior y el hueco vuelve a estar tapado.
15. **Reabrir no pierde lo revelado.** `host_reabrir_pulsaciones` deja
    `revelados` igual que estaba.
16. **Selección simple intacta.** Las 67 pruebas actuales siguen verdes sin
    cambiar una línea. Si alguna se cae, el contrato rompió el juego viejo.

### JavaScript

17. `estadoDesdeServidor` no inventa `respuesta` cuando el servidor no la
    manda: si llega `null`, se queda `null`.
18. Los seis mensajes de felicitación se alternan y ninguno se repite dos
    veces seguidas.
19. El contador de puntaje propio muestra `sin conexión` y no `0` cuando aún
    no hay estado, para no hacer creer que el jugador perdió sus puntos.

---

## 9. Fuera de alcance de este contrato

- El editor de versículos tiene su propio documento: `docs/completar-versiculo-editor.md`.
- La ceremonia y el podio no cambian: reusan `final_scoreboard` y `render.js`.
- El modo local (`engine.js`, sin servidor) no se extiende a este juego en la
  primera entrega. Se juega solo contra Supabase.
