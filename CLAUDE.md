# Turno de Noche (juego de navegador)

Juego de supervivencia zombi en 3D low-poly (Three.js + Vite, JavaScript con módulos ES). Un policía defiende una comisaría con ciclo de día y noche, construcción de defensas, tiendas físicas y meta-progresión.

> Este proyecto NO tiene relación con el EA de trading (ORB Breakout) del `CLAUDE.md` de la carpeta superior. Ignora ese contexto aquí.

## Contexto
- Usuario: Carlos. Responder siempre en español.
- La especificación completa está en `PROMPT_JUEGO_ZOMBIS.md` (diseño, fases, agentes). El estado actual está en `PROGRESS.md`.
- El desarrollo va **por fases**: al cerrar cada una se para y se espera el visto bueno de Carlos.

## Comandos
- `npm run dev`: servidor de desarrollo en http://localhost:5173 (configuración "juego" de `.claude/launch.json` para `preview_start`).
- `npm test`: tests unitarios con Vitest (`tests/`).
- `npm run build`: build de producción en `dist/`.

## Convenciones
- La lógica avanza en pasos fijos de 1/60 s (`core/FixedStepLoop.js`); el render va por frame.
- La entrada pasa siempre por acciones abstractas (`input/Input.js`): `consume()` para pulsaciones e `isHeld()` para teclas mantenidas.
- Todo el equilibrado va en `src/data/*.json`. Nada de números mágicos en la lógica.
- Sin asignaciones por frame en los bucles calientes: reutilizar vectores temporales y pools.
- Para depurar y hacer QA:
  - `window.__game` expone el juego.
  - `__game.simulate(segundos)` avanza la simulación de forma síncrona. Úsalo cuando el panel del navegador está oculto, porque el navegador congela `requestAnimationFrame`.
  - F1 abre el panel de depuración.
- Solo assets CC0, registrados en `CREDITS.md`. Los candidatos están en `ASSETS_CATALOGO.md`.

## Agentes (`.claude/agents/`)
- Opus: director (sesión principal) y `code-reviewer`.
- Sonnet: `gameplay-dev`, `level-builder`, `qa-tester`, `balance-analyst`.
- Haiku: `asset-scout`, `docs-keeper`.
- Si un agente falla dos veces en la misma tarea, se sube de modelo.
