# Progreso

| Fase | Estado |
|---|---|
| 0. Preparación | ✅ Hecha |
| 1. Núcleo jugable | ✅ Hecha (pendiente del visto bueno de Carlos) |
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

## Placeholders pendientes de sustituir
- **Detalle del interior**: el mobiliario son cajas. Se hará una pasada de props por código al estilo de la referencia (escritorios con ordenador, taquillas, estanterías, plantas, carteles, camillas, armero, coches patrulla con sirena…).
- Todo el arte. Se sustituirá en la fase 6 por los assets aprobados.
- Props sin asset CC0 encontrado: trampas (pinchos, cepo, mina, alambre), sacos de arena, generador, foco, celdas o rejas y mobiliario de oficina. Se modelarán por código en estilo low-poly si no aparecen.

## Bugs conocidos
- Ninguno.
