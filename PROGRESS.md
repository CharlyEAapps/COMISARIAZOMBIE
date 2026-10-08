# Progreso

| Fase | Estado |
|---|---|
| 0. Preparación | ✅ Hecha |
| 1. Núcleo jugable | ✅ Hecha |
| 2. Día/noche, oleadas, decoración e interacciones | ✅ Hecha (pendiente del visto bueno de Carlos) |
| 3. Construcción | ⏳ Pendiente |
| 4. Tiendas | ⏳ Pendiente |
| 5. Enemigos y defensas completos | ⏳ Pendiente |
| 6. Arte y sonido | ⏳ Pendiente |
| 7. Meta-progresión y menús | ⏳ Pendiente |
| 8. Controles y pulido | ⏳ Pendiente |

## Fase 0: qué hay
- Proyecto Vite 8 + Three.js 0.186 + Vitest 5 + lil-gui, con versiones exactas en `package.json`.
- Bucle de paso fijo a 60 Hz con límite de subpasos, máquina de estados (jugando/pausa) y bus de eventos.
- Cámara en perspectiva inclinada 57°, FOV 40°, con seguimiento suave, anticipación hacia el ratón y zoom con la rueda.
- Capa de entrada con acciones abstractas (preparada para gamepad y táctil).
- Panel de depuración (F1): calidad, inclinación y FOV de cámara, rejilla y modo dios, más contador de FPS y draw calls.
- Escena sandbox: suelo de 80×80 m con rejilla de 1 m, un marcador que se mueve con WASD y cajas de referencia.
- `__game.simulate(s)` para hacer QA con la pestaña oculta.
- Agentes en `.claude/agents/` (están disponibles al reiniciar la sesión de Claude Code).
- Catálogo de assets CC0 en `ASSETS_CATALOGO.md`, **pendiente de aprobación**.

## Fase 1: qué hay
- Mapa de la comisaría en ASCII (`src/data/map.json`, generado con `tools/genmap.cjs`):
  - 80×80 m, con edificio de 34×22: recepción, oficinas, calabozos, armería, enfermería y almacén.
  - Aparcamiento, patio, valla con 3 accesos y 8 puntos de aparición.
- Estilo maqueta: tabiques finos con remate oscuro, suelo en damero y recorte con tramado de los muros que tapan al jugador.
- Policía de bloques con gorra, placa y pistola, animado por código.
- Movimiento, esprint con resistencia (histéresis de 15) y colisiones con las mismas cajas que se dibujan.
- Pistola semiautomática:
  - 25 de daño, cargador de 12, recarga manual y automática, búfer de clic.
  - Trazadoras, fogonazo, partículas de cubitos, retroceso del zombi y temblor de cámara.
- Zombi caminante:
  - Flow field (Dijkstra) hacia el jugador, persecución directa con línea de visión.
  - Separación y colisión entre zombis, ataque con preparación y sin golpear a través de muros.
  - Render instanciado: 6 draw calls para toda la horda.
- Generador de prueba con ritmo creciente (lo sustituye la fase 2).
- HUD (vida, resistencia, puntos, bajas, tiempo, arma y munición), pausa, game over y reinicio con Enter.
- Rendimiento: 150 zombis → 0,8 ms de CPU por frame y 54 draw calls.
- QA (Sonnet) y revisión de código (Opus) hechas. Corregidos:
  - Golpes a través de muros.
  - Centro de una entidad sobre una celda de muro (no se podía disparar y los zombis se atascaban).
  - Salientes invisibles en esquinas en L y en T.
  - Apilamiento de zombis y arrastre del jugador por la horda.
  - Parpadeo del esprint.
  - Fogonazo al otro lado del muro.
  - Sombras obsoletas y FOV en pantallas verticales.
  - Closures en bucles calientes y constantes fuera de `src/data`.

## Fase 2: qué hay
- **Ciclo:**
  - Día (60 s el primero, 90 s el resto, N para adelantarlo) → atardecer con sirena (15 s) → noche (140 s + 12 s por noche, hasta 260) → amanecer (6 s).
  - Reloj de 07:00 a 05:00; marca "05:00+" si la noche se alarga.
  - La noche no termina hasta abatir toda la horda.
- **Oleadas:**
  - Horda por noche: 14, 22, 32, 43, 55…
  - Con cada noche aumentan la vida (+6 %), la velocidad (+2,5 %, tope +35 %), el máximo de zombis vivos y los puntos de aparición activos.
  - Rezagados de día a partir del día 2.
- **Iluminación:**
  - Paletas de día, atardecer y noche, y el sol cruzando el cielo.
  - Linterna con sombras, farolas (charcos de luz y 4 luces reales reasignadas) y luces interiores con generador.
  - Ojos brillantes de los zombis, alarma roja y sirenas de los coches.
- **Puntuación:**
  - Combos (×1,5 cada 5 bajas, tope ×3) y números flotantes.
  - Bonus al amanecer (noche × 100 y +75 × noche si no te han tocado).
  - Casos de la pizarra.
- **Decoración procedural:**
  - 63 tipos de props y 208 instancias en 7 draw calls: escritorios con monitores, mostradores con mampara, armero, taquillas, celdas con camastro, váter y barrotes, camillas, coches patrulla rotulados, mástiles con bandera, rótulos…
- **24 interacciones** (tecla E mantenida, aviso, barra de progreso y marcadores "!"): cafetera, vending, fuente, 4 taquillas, 2 archivadores, 2 botiquines de pared, 2 camas, teléfono, radio, cámaras, generador, cuadro eléctrico, pizarra de casos, sirena de 4 coches (señuelo con rutas reales) y alarma.
- **Botiquines** (Q): curan 40; máximo 3; empiezas con 1.
- **QA (Sonnet) y revisión (Opus) hechas.** Corregidos:
  - Informe del archivador vacío y botiquín de botín con el inventario lleno.
  - Señuelo que atravesaba muros (ahora con flow field propio).
  - Ciclo que avanzaba con el jugador muerto.
  - Radio que hablaba de la noche equivocada al amanecer.
  - Generador arrancable al amanecer y daño que no cancelaba la interacción.
  - Botiquín que se gastaba con la vida llena.
  - Sombra de la linterna calculada de día.
  - Parpadeos con reloj real (ahora con tiempo de juego).
  - Normales de los elipsoides, colores del terreno duplicados, números mágicos llevados a JSON y asignaciones por frame.

## Placeholders pendientes de sustituir
- Arte: todo procedural en el estilo de la referencia (decisión de Carlos). Los packs CC0 solo se usarán para sonido y música (fase 6).
- Trampas, barricadas y armas: se modelarán por código en sus fases.

## Ideas de Carlos (backlog)
- ✅ (fase 2, hecha) **Cafetera:** +10 % de velocidad de movimiento durante 30 s; 2 min de espera hasta el siguiente café.
- ⏳ (fase 3) **Transformador con vida**, que sustituye al generador:
  - Funciona desde el inicio y, de noche, da más luz a la comisaría.
  - Los zombis pueden estropearlo; sin él, solo queda la linterna.
  - Se puede reparar en cualquier momento (coste proporcional al daño).

## Bugs conocidos
- Ninguno.
