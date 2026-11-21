# 00 — Reglas de trabajo de este proyecto

## Pedidos que llegan a mitad de otra cosa: al ODD, no al medio

**Regla declarada por Christian el 2026-11-21.**

> «si te hago peticiones en medio de que estás trabajando algo y no tiene que
> ver con lo que ya estás tratando, encolalo en el odd.»

Cuando llega un pedido que **no pertenece** a la tarea en curso:

1. **No se interrumpe** lo que se está haciendo. Un cambio a medias deja el
   árbol en un estado que no compila ni se puede probar.
2. Se **anota en el ODD**, en `odd/tasks/`, con lo que pidió, tal cual.
3. Se termina y se commitea lo que estaba en curso.
4. Se atiende la cola **en el orden en que llegó**, salvo que Christian diga
   otra cosa.

**Cómo distinguir «en medio» de «es lo mismo»:** si el pedido toca el mismo
archivo, la misma pantalla o el mismo defecto, es parte de lo que se está
haciendo y se atiende ya. Si toca otra cosa, va a la cola.

**Por qué.** Ya pasó en esta sesión: reescribir cuatro artboards para cambiar
unos valores perdió trabajo aprobado y metió defectos nuevos. Un pedido que
entra a mitad de otro convierte dos cambios limpios en dos cambios a medias.

## Cola actual

### C1 — Menú: no se puede deslizar desde cualquier parte
Reportado por Christian el 2026-11-21 mientras se cerraba el canvas.
Síntoma: «en menú no puedo deslizar desde cualquier parte, solo si deslizo
pisando inicialmente la portada, no debería ser así sino en general».

Estado: NO resuelto. Ya se quitó `overflow-y: auto` y
`overscroll-behavior: contain` de `.menu-cuerpo`, y la medición dio
`paginaScrollea=true` (1457 px de contenido en 844 de ventana). Aun así vuelve
a pasar, así que queda otro contenedor con scroll propio o un `touch-action`
en el camino. Hay que medirlo en el dispositivo, no suponerlo.
