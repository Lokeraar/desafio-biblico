# Completar el versículo — diseño acordado

Segundo tipo de juego. Convive con **selección simple** en las mismas tablas:
`questions`, `rounds`, `answers` y `players` se reusan; lo que cambia es la
forma de la pregunta y cómo se decide el acierto.

Decisiones tomadas con el usuario el 18/11/2026. Cualquier cambio va aquí
primero.

---

## 1. La idea en una frase

Se muestra un versículo con una o varias palabras tapadas. Los participantes
pulsan; el primero en pulsar dice el versículo en voz alta y el presentador
destapa las palabras que acertó. Los huecos que quedan tapados pasan al
siguiente de la lista.

---

## 2. La pregunta

El versículo se guarda **una sola vez**, con cada hueco entre llaves:

```
Vosotros sois nuestra {carta}, escrita en nuestros {corazones}, conocida y {leída} por todos los hombres
```

Los huecos se derivan de esa línea: índice, respuesta y posición no se guardan
aparte, se calculan. Así es imposible que el texto diga una cosa y la respuesta
otra.

- `questions.texto_marcado` — el versículo con las llaves.
- `questions.prompt` — lo **escribe la base al guardar**, con solo el primer
  hueco en blanco: `Vosotros sois nuestra ____ , escrita en nuestros corazones, …`
  Es lo que imprime la tele y el teléfono, sin cambios en su código.
- `questions.options` y `correct_option` quedan nulos para este juego. Los
  `CHECK` de cuatro opciones pasan a aplicarse solo a `seleccion-simple`.

Tope: 34 huecos por versículo, para que la pantalla no se desborde.

---

## 3. Estados de la ronda

`rounds.state` gana un valor: `juicio`.

| Estado | Qué significa | Quién puede actuar |
|---|---|---|
| `prepared` | Pregunta cargada, temporizador sin soltar | El presentador suelta la ventana de pulsaciones |
| `open` | Ventana de pulsaciones corriendo | Cualquiera que no haya pulsado |
| `juicio` | Ventana cerrada, hay lista ordenada | Solo el presentador: ❌ / ✅ / deshacer |
| `closed` | Ronda terminada | Nadie; el presentador pasa a la siguiente |
| `revealed` | Todos los huecos a la vista | Nadie; ya se repartieron los puntos |

La ventana de pulsaciones se cierra por cualquiera de estas tres causas:

1. Se agota el temporizador.
2. Todos los participantes de la sala ya pulsaron.
3. El presentador pulsa **Cerrar pulsaciones**.

Nadie pulsó → la ronda se cierra sin ganador y sin revelar huecos nuevos; el
presentador solo ve **Siguiente pregunta →**.

---

## 4. El turno

`answers.seq bigserial` **es** la secuencia monotónica. No se inventa otra.

- Pulsar el botón inserta una fila en `answers` con `option_key` nulo y
  `veredicto` nulo. El índice `UNIQUE(round_id, player_id)` impide pulsar dos
  veces.
- El turno es el primer `seq` cuyo `veredicto` sea nulo o `parcial`. Es decir:
  el que falló tiene `veredicto = 'incorrecto'` y sale de la lista; el que
  acertó algunas palabras sigue en su lugar hasta que el presentador lo
  sentencie del todo.
- `rounds.turno_answer_id` guarda el turno actual, para que recargar el panel
  del presentador no pierda la lista.

**Solo hacia adelante.** Nadie vuelve a pulsar en la misma ronda. Lista
agotada → se destapan los huecos que falten y la ronda se revela conservando
los puntos ya ganados.

---

## 5. Sentenciar

El presentador tiene dos botones y un deshacer.

### ✅ Correcto

Abre un modal con una casilla por hueco todavía tapado. Marca las que el
participante dijo bien y confirma.

- Las marcadas se destapan **en todas las pantallas**.
- Se anotan en `answers.huecos_ganados` de esa pulsación.
- `veredicto` pasa a `parcial` si quedan huecos tapados, o `correcto` si no
  queda ninguno.
- Si quedan huecos, el turno pasa al siguiente de la lista.
- Si no queda ninguno, la ronda se cierra sola.

### ❌ Incorrecto

`veredicto = 'incorrecto'`, no destapa nada, el turno pasa al siguiente.
Disponible también cuando el participante ya tenía un `parcial`: cierra su
turno sin quitarle las palabras que ya ganó.

### ↶ Deshacer

Un toque, sin confirmación. Deshace **la última sentencia completa**, no el
último toque: si se marcaron dos casillas de más, basta un toque. Vuelve el
turno al participante anterior, retira las palabras que se le habían dado y
reabre ese hueco.

---

## 6. Puntos

El versículo vale **10 puntos en total**, repartidos según los huecos que
acertó cada quien.

- `K_p` = huecos que ganó el participante `p`. `N` = huecos del versículo.
- `S = ΣK_p`. Con la garantía de que un hueco se gana una sola vez, `S ≤ N`.
- Cupo total = `floor(10 × S / N)`.
- Ese cupo se reparte entre los participantes **por mayor resto** —primero
  `floor(cupo × K_p / S)` a cada uno, y los puntos sueltos a los restos más
  altos—, de modo que la suma no pase nunca del cupo y nadie reciba más de lo
  proporcional. La fórmula completa, con el desempate por `seq`, está en
  `docs/completar-versiculo-contrato.md` §6.
- `S = 0` (nadie acertó nada) → nadie suma, `rounds.no_winner = true`.
- Los puntos se otorgan **al cerrar la ronda**, no al sentenciar. Así el
  marcador no depende del orden de los juicios y un deshacer nunca deja puntos
  sueltos.

Ejemplos con `N = 3`:

| Reparto de huecos | Puntos |
|---|---|
| Ana 3 | Ana 10 |
| Ana 2, Beto 1 | Ana 7, Beto 3 |
| Ana 1, Beto 1, Caro 1 | Ana 4, Beto 3, Caro 3 |
| Ana 2, resto sin acertar | Ana 6 |

**La ronda la gana el versículo**, no una persona: al completarse no hay un
único ganador. `rounds.winner_player_id` queda nulo en este juego.

---

## 7. Lo que ve cada pantalla

### Participante

| Momento | Qué ve |
|---|---|
| Sala de espera | Su nombre, el código, "Esperando que el presentador suelte la primera pregunta" |
| Ventana abierta | El versículo con los huecos en blanco y un **botón negro grande** como el OK del mando: pulsar es tomar el turno |
| Ya pulsó | El botón se bloquea y dice "Pulsaste" |
| Le toca contestar | El versículo + **"Estás contestando"** |
| Espera su turno | El versículo + "Está contestando: [nombre]" + **"Fuiste el 3 en pulsar"** |
| No pulsó | El versículo + botón apagado + "No pulsaste esta ronda" |
| Alguien falló | **"❌ [nombre] no acertó"** y "Es turno de [siguiente]" |
| Alguien acertó todo | **"✅ [nombre] acertó, ha ganado esta ronda"** |
| Él mismo acertó todo | **"✅ [nombre] ¡Acertaste, felicidades!"**, alternando seis variantes |

Las seis variantes, cambia solo el arranque:

1. ¡Acertaste, felicidades!
2. ¡Correcto, te la sabías!
3. ¡Exacto, muy bien!
4. ¡La diste!
5. ¡Perfecto, esa era!
6. ¡Acertaste, qué memoria!

Variante cuando el versículo se completa entre varios: **"✅ El versículo
quedó completo"**, y debajo quién aportó cada palabra.

En todos los estados, el participante lleva **su puntaje en una esquina**, en
un contador discreto: tamaño de etiqueta, sin barra ni tabla. No se ve a
distancia y no compite con el versículo. No muestra su puesto en la sala.

### Televisor

Todo lo del participante, salvo los mensajes personales ("Estás contestando",
"No pulsaste esta ronda") y salvo el puntaje. **Nunca muestra marcador
durante la partida, ni destapa un hueco antes de que el presentador lo
sentencie.** Al terminar la partida aparece la ceremonia con el podio, igual
que en selección simple.

Sí muestra el número de orden del que contesta, para que la congregación
entienda por qué le toca a él: **"Contestando: Ana (fue la 2 en pulsar)"**.

### Panel del presentador

| Momento | Botones |
|---|---|
| `prepared` | **▶ Soltar temporizador (Ns)** · **👁 Ver respuesta** · **🔄 Cambiar versículo** |
| `open` | **⏸ Pausar** · **Cerrar pulsaciones** · **🔄 Cambiar versículo** |
| `juicio` | La lista ordenada con ❌ / ✅ junto al de turno · **↶ Deshacer** · **Cerrar pregunta** (destapa lo que falta y conserva los puntos ya ganados) |
| `closed` | La ronda terminó con todos los huecos a la vista. **Siguiente versículo →** · **↶ Deshacer** |
| `revealed` | **🔁 Repetir** · **Siguiente versículo →** |

**Ver respuesta** abre un modal con el versículo, las palabras tapadas
destacadas y cuántos huecos tiene. Solo para los ojos del presentador.

---

## 8. Texto de la semilla

Los 29 versículos de `Cuestionario 2 carta Corintios.docx`, fase 3, **tal cual
vienen en el documento**: con sus faltas, sus mayúsculas y el de 6:14 cortado
en "pues". Se corrigen desde el editor antes de la primera partida.

Total: 29 versículos, 63 huecos.

`2 Corintios 3:17` y `6:14` entran dos veces cada uno, con hueco distinto,
porque son dos preguntas distintas del mismo versículo.

Tema nuevo: **"2 Corintios"**, `game_slug = 'completar-versiculo'`, separado
del tema homónimo de selección simple.

---

## 9. Editor

En el panel de administración, junto al de selección simple pero en su propio
tema.

- Lista de versículos: referencia, texto y cuántos huecos tiene.
- Formulario de **un versículo** por vez: referencia, el texto completo, y
  nada más.
- Para marcar un hueco: se pulsa **Ocultar** y después se toca la palabra. El
  modo queda armado hasta que se vuelve a pulsar. Tocar una palabra ya
  marcada la desmarca.
- Las palabras ocultas se ven **subrayadas** en el formulario.
- **↔ Deshacer**, encima del botón de ocultar, visible solo cuando hay algo
  que deshacer, y deshaciendo **de a una palabra** en orden inverso. Guarda
  los últimos 10 pasos.
- **Tope de 34 huecos: bloquea.** Al intentar ocultar la 35 no se oculta y se
  avisa. Antes el tope solo estaba escrito aquí; el editor no lo comprobaba.

> **Cambio del 20/11/2026:** se quitó **Quitar todo** a propósito. Deshacer ya
> es secuencial y de a un paso, así que un botón que vacía todos los huecos de
> golpe solo servía para perder trabajo sin querer. Si hiciera falta, se agrega
> después con confirmación.
- Al guardar se serializa con llaves, se recalculan los huecos y se reescribe
  la pregunta. Si el versículo ya se jugó alguna vez, se avisa antes de
  guardar: cambiarlo altera partidas pasadas.

---

## 10. Decisiones cerradas el 18/11/2026

| Decisión | Resuelto |
|---|---|
| **Cerrar pregunta** a mitad del juicio | Destapa los huecos que faltaban, conserva los puntos ya ganados y no reparte puntos nuevos |
| **Puntaje del participante** | Lo ve en su propio teléfono, en un contador discreto en una esquina. No ve su puesto |
| **Número de orden en la tele** | Sí: «Contestando: Ana (fue la 2 en pulsar)» |
| **Al que no pulsó** | El versículo, el botón apagado y «No pulsaste esta ronda» |
| **Pausa durante el juicio** | No existe: el botón de pausa se oculta. Ahí no corre ningún reloj |
| **Reparto de versículos** | Aleatorio, evitando repetir uno mientras queden otros sin salir |
| **Tope de huecos** | 34 por versículo, para que el texto quepa en pantalla |

Ya no queda nada por decidir. Lo siguiente es la entrega 1: la base de datos.
