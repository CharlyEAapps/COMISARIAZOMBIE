# Progreso

| Fase | Estado |
|---|---|
| 0. Preparación | ✅ Hecha (pendiente del visto bueno de Carlos) |
| 1. Núcleo jugable | ⏳ Pendiente |
| 2. Día/noche y oleadas | ⏳ Pendiente |
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

## Placeholders pendientes de sustituir
- Todo el arte. Se sustituirá en la fase 6 por los assets aprobados.
- Props sin asset CC0 encontrado: trampas (pinchos, cepo, mina, alambre), sacos de arena, generador, foco, celdas o rejas y mobiliario de oficina. Se modelarán por código en estilo low-poly si no aparecen.

## Bugs conocidos
- Ninguno.
