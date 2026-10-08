# Prompt de desarrollo: "Turno de Noche" (título provisional)

Quiero que desarrolles conmigo, por fases, un videojuego de supervivencia contra zombis para el navegador. Lee el documento entero antes de escribir código. Respóndeme siempre en español.

---

## 1. Concepto

Soy un policía atrapado en una **comisaría** durante un apocalipsis zombi. De día preparo la defensa: compro armas, construyo barricadas y pongo trampas. De noche llegan las hordas. El objetivo es **sobrevivir el mayor número de noches posible**. Cuando muero, gano medallas que desbloquean mejoras permanentes para la siguiente partida.

- **Vista:** 3D low-poly con cámara en perspectiva inclinada (no totalmente cenital), al estilo de *Dead Ops Arcade* o *They Are Billions*.
- **Control híbrido:** combate twin-stick + modo construcción sobre cuadrícula.
- **Tono intermedio:** de noche el ambiente es oscuro y tenso, pero la jugabilidad es arcade y ágil. Sin gore explícito: salpicaduras oscuras discretas y cadáveres que se desvanecen.

---

## 2. Tecnología y requisitos técnicos

- **Three.js** (versión estable fijada en `package.json`) + **Vite** + JavaScript con módulos ES. Nada de frameworks de UI pesados: el HUD y los menús se hacen en HTML/CSS superpuestos al canvas.
- Las físicas son propias y sencillas sobre el plano XZ: colisiones círculo-círculo y círculo-rectángulo, con una rejilla espacial (spatial hash) para las consultas. No hace falta un motor de físicas.
- Antes de empezar, comprueba que Node.js está instalado. Si no lo está, dime cómo instalarlo y espera.
- Crea `.claude/launch.json` con el servidor de desarrollo de Vite para poder abrir y probar el juego en el navegador integrado de Claude Code (`preview_start`). **Prueba tú mismo cada fase en el navegador**: juega, haz capturas y revisa la consola antes de darme la fase por terminada.
- **Rendimiento objetivo:** 60 FPS con 150 zombis en pantalla en un portátil medio. Usa object pooling para balas, zombis, partículas y números de daño; `SkeletonUtils.clone` para los modelos animados; un número limitado de luces que proyectan sombras, y un selector de calidad (baja/media/alta) en opciones.
- **Todos los valores de equilibrado** (vida, daño, velocidades, precios, duración del día y la noche, escalado de oleadas) van en archivos `src/data/*.json` o en un módulo de configuración, nunca escritos a mano dentro de la lógica.
- Crea un **panel de depuración** (lil-gui, oculto con la tecla F1) con: modo dios, +1000 puntos, saltar al día o a la noche, generar un zombi de cada tipo, mostrar la rejilla de pathfinding y el flow field, y contador de FPS y de entidades.
- Haz **tests unitarios con Vitest** de la lógica pura: flow field, economía, escalado de oleadas, daño y reparación de estructuras, y guardado.
- El guardado (récords y mejoras permanentes) va en `localStorage`, con esquema versionado y envuelto en try/catch, de forma que el juego funcione aunque el almacenamiento falle.

### Estructura orientativa
```
index.html
src/
  main.js               # arranque
  core/                 # bucle de juego (paso fijo), eventos, estados (menú, partida, pausa, fin)
  render/               # escena, cámara, iluminación, oclusión, efectos
  input/                # teclado/ratón, gamepad, táctil → acciones abstractas
  entities/             # jugador, zombis, proyectiles, estructuras, trampas
  systems/              # IA, pathfinding, combate, construcción, economía, día/noche, oleadas, audio
  ui/                   # HUD, tienda, modo construcción, menús, minimapa
  data/                 # JSON de equilibrado
  save/                 # récords y meta-progresión
public/assets/{models,textures,audio,music}/
tests/
CREDITS.md  PROGRESS.md  README.md  CLAUDE.md
```
Crea también un `CLAUDE.md` propio en esta carpeta con el contexto del juego, para que las sesiones futuras no lo mezclen con otros proyectos de la carpeta superior.

---

## 3. Equipo de agentes (eficiencia de modelos)

Crea subagentes en `.claude/agents/*.md`, cada uno con su campo `model:` en el frontmatter, sus herramientas mínimas y una descripción clara. Asigna a cada tarea el modelo más barato que la haga bien:

| Agente | Modelo | Responsabilidad |
|---|---|---|
| **Sesión principal (director)** | opus | Arquitectura, decisiones de diseño, sistemas difíciles (bucle de juego, flow field, IA de hordas, rendimiento), coordinación de los agentes e integración final. |
| `gameplay-dev` | sonnet | Implementa funcionalidades bien especificadas: armas, trampas, tienda, construcción, HUD y menús. |
| `level-builder` | sonnet | Monta la comisaría (distribución, colisiones, rejilla de navegación, puntos de aparición, iluminación de la escena) a partir de los assets. |
| `qa-tester` | sonnet | Juega en el navegador integrado, intenta romper el juego, revisa la consola y la rejilla de depuración y devuelve una lista de bugs reproducibles con capturas. No edita código. |
| `balance-analyst` | sonnet | Ajusta los JSON de equilibrado con simulaciones o cálculos (DPS, puntos por noche, coste por kill) y justifica cada cambio. |
| `code-reviewer` | opus | Al cerrar cada fase revisa el diff buscando bugs, fugas de memoria (geometrías y texturas sin `dispose`), problemas de rendimiento y código duplicado. |
| `asset-scout` | haiku | Busca y descarga assets **CC0** (modelos, sonidos, música), comprueba la licencia en la página de origen, los organiza en `public/assets` y los registra en `CREDITS.md` (nombre, autor, URL, licencia). |
| `docs-keeper` | haiku | Mantiene al día `PROGRESS.md`, `README.md` (cómo arrancar y controles) y el changelog al final de cada fase. |

Reglas del equipo:
- Lanza agentes **en paralelo** solo cuando sus tareas sean independientes y **no toquen los mismos archivos**. Si dos agentes de código tienen que trabajar a la vez, usa worktrees aislados.
- Cada encargo a un agente debe ser autónomo: incluye los archivos implicados, el objetivo, los criterios de aceptación y lo que no debe tocar.
- No delegues lo que cuesta menos hacer directamente. Una corrección de dos líneas no necesita un agente.
- Si un agente de un modelo inferior falla dos veces en la misma tarea, súbela de nivel (haiku → sonnet → opus).

---

## 4. Diseño del juego

### 4.1 El escenario: la comisaría
Mapa fijo, diseñado a mano, de unos 80×80 m, con una rejilla de construcción de 1 m:
- **Edificio principal:** recepción, oficinas, calabozos, **armería**, **enfermería** y **almacén de pruebas** (estos tres son las tiendas).
- **Exterior:** aparcamiento con coches patrulla, valla perimetral con 2-3 accesos (portón de vehículos, puerta peatonal y un hueco roto en la valla), farolas y una zona trasera con contenedores.
- Hay 4-6 **puntos de aparición** fuera del perímetro (calles y callejones), y algunos se desbloquean en noches más avanzadas.
- Los edificios se ven **sin techo**. Los muros que quedan entre la cámara y el jugador se vuelven semitransparentes.

### 4.2 Cámara y controles
- Cámara en perspectiva a unos 55-60° de inclinación, con FOV de unos 40° y seguimiento suave. Se adelanta un poco hacia donde apunta el ratón y tiene un zoom limitado con la rueda.
- **Teclado y ratón:** WASD para moverse, ratón para apuntar, clic izquierdo para disparar, R para recargar, Shift para esprintar (con resistencia), 1-5 o la rueda para cambiar de arma, G para lanzar granada, E para interactuar (tiendas, reparar, abrir y cerrar puertas), Q para usar botiquín, **B para el modo construcción** y Esc para pausa.
- **Modo construcción:** se ve la cuadrícula y una vista previa fantasma (verde si se puede colocar, roja si no). R rota la pieza, clic coloca, clic derecho cancela y hay opciones de vender (devuelve el 50 %), reparar y mejorar. De noche se puede construir, pero cuesta un 50 % más.
- **Gamepad** (Gamepad API): stick izquierdo para moverse, stick derecho para apuntar, gatillo derecho para disparar y botones equivalentes al resto de acciones.
- **Táctil** (móvil): dos joysticks virtuales y botones en pantalla. Se activa al detectar una pantalla táctil.
- Toda la entrada pasa por una capa de **acciones abstractas** para que los tres sistemas de control convivan.

### 4.3 Ciclo de día y noche
- **Día** (unos 90 s): luz cálida y algún zombi rezagado suelto. Las tiendas están abiertas a precio normal. Es el momento de construir, comprar y reparar. Un botón "Estoy listo" adelanta la noche.
- **Atardecer:** una sirena suena 15 s antes de la noche y la luz se tiñe de naranja.
- **Noche** (unos 150 s, que aumentan con cada noche): oscuridad casi total. La horda escala con el número de noche, en cantidad, tipos y velocidad. La noche termina cuando se acaba el tiempo **y** no queda ningún zombi vivo. Al terminar se cobra un bonus de supervivencia.
- **Iluminación nocturna:** la linterna del policía (un foco en cono que sigue la dirección de apuntado), las farolas, las luces de emergencia rojas y azules de los coches patrulla, los fogonazos de disparo y los **focos comprables**. Los ojos de los zombis brillan débilmente en la oscuridad.

### 4.4 Zombis
| Tipo | Rasgos |
|---|---|
| **Caminante** | Lento, vida media. Es la base de la horda. |
| **Corredor** | Rápido y frágil. Aparece en grupos. |
| **Tanque** | Lento, mucha vida, hace triple de daño a las estructuras y te empuja al golpearte. |
| **Explosivo** | Hinchado. Explota al morir o al alcanzarte, con daño en área a ti, a otros zombis y a las estructuras. Puede provocar reacciones en cadena. |
| **Escupidor** | Mantiene la distancia y lanza ácido en arco que deja un charco temporal. Daña también las estructuras. |
| **Jefe "Antidisturbios"** (cada 5 noches) | Policía antidisturbios zombificado, grande y con un escudo frontal inmune a las balas. Hay que flanquearlo o usar explosivos. Tiene barra de vida propia en el HUD y escala en cada aparición. |

**IA y pathfinding:**
- Usa un **flow field** sobre la rejilla, hacia el jugador (o hacia un señuelo activo). Se recalcula cuando cambia una construcción y periódicamente cuando el jugador cambia de celda.
- Las estructuras tienen un **coste de paso proporcional a su vida**. Así, si encierras la base por completo, los zombis eligen y atacan la barricada más débil en lugar de quedarse atascados.
- Incluye separación entre zombis (steering) para que no se amontonen en el mismo punto, y un sistema de estados: vagar, perseguir, atacar estructura, atacar al jugador y aturdido.

### 4.5 Economía y tiendas
- **Puntos por kill** según el tipo; bonus por **combo** (kills seguidas en poco tiempo); bonus por noche superada; bonus por no recibir daño en una noche.
- Las tiendas son **lugares físicos** dentro de la comisaría: te acercas y pulsas E. Están abiertas a precio normal de día y con un **recargo del 50 % de noche**.
  - **Armería:** pistola (inicial, munición de reserva infinita), escopeta, subfusil, fusil de asalto, rifle de precisión (atraviesa enemigos), táser (aturde), porra (cuerpo a cuerpo, sin munición), granadas y munición para cada arma. Cada arma tiene **3 niveles de mejora**: daño, cargador y velocidad de recarga.
  - **Enfermería:** botiquín pequeño (+35 de vida), botiquín grande (+100), chaleco antibalas (armadura que absorbe daño) y un aumento de la vida máxima para esa partida.
  - **Almacén:** muros, trampas y utilidades (ver abajo).

### 4.6 Construcción y trampas
Todas las piezas tienen vida, **se pueden destruir**, se **reparan** pagando en proporción al daño y se **mejoran** por niveles.
- **Barricada / muro:** madera → metal → hormigón (más vida en cada nivel).
- **Puerta reforzada:** tú la abres y cierras con E; los zombis tienen que romperla.
- **Sacos de arena:** bajos. Bloquean el paso de los zombis, pero dejan pasar las balas, así que puedes disparar por encima.
- **Trampas:** pinchos (daño continuo, se desgastan), cepo (inmoviliza unos segundos), mina (un solo uso), alambre de espino (ralentiza y hace poco daño), barril explosivo (se detona disparándole), **valla electrificada** (necesita un generador comprado; los zombis pueden atacar el generador) y **torreta automática** (cara, con munición limitada que se recarga pagando).
- **Utilidades:** foco (ilumina una zona de noche) y **señuelo de coche patrulla** (activa la sirena y atrae a los zombis durante 10 s).

### 4.7 Muerte y meta-progresión
- Al morir aparece un resumen con noches sobrevividas, kills por tipo, puntos, arma favorita y **medallas ganadas**, que dependen de las noches y de los logros.
- **Tablón de la comisaría** (menú principal): las medallas se gastan en mejoras permanentes, como vida máxima, puntos iniciales, empezar con escopeta, descuento en la armería, linterna más potente, recarga más rápida o una barricada gratis al empezar.
- **Récords locales:** las 10 mejores partidas.

### 4.8 Audio
Disparos distintos para cada arma, recargas, gruñidos con variaciones, golpes en las barricadas, explosiones, sirena al atardecer, música ambiental de día y música tensa de noche. El sonido es posicional (`THREE.PositionalAudio`) y en opciones hay volúmenes separados para música y efectos.

### 4.9 HUD y menús
- **HUD:** vida, armadura, resistencia, arma y munición, puntos, reloj de día/noche con el número de noche, zombis restantes, minimapa con estructuras, tiendas y zombis cercanos, y números de daño flotantes.
- **Menús:** menú principal (jugar, tablón de mejoras, récords, opciones, controles), pausa y pantalla de fin de partida.

---

## 5. Assets
- Usa **solo assets CC0**: Kenney (kenney.nl), Quaternius (quaternius.com), Poly Pizza (poly.pizza, filtrando solo CC0) y OpenGameArt / Freesound (filtrando solo CC0) para audio y música.
- Necesitamos un policía con animaciones (idle, correr, apuntar, morir), zombis con animaciones (la variedad se consigue con tintes y escalas si no hay modelos para cada tipo), edificios y mobiliario urbano, coches, armas, props de trampas y barricadas.
- No inventes URLs. Si no encuentras un asset adecuado, usa un placeholder generado por código y anótalo en `PROGRESS.md` como pendiente.
- Todo debe quedar registrado en `CREDITS.md`.

---

## 6. Plan por fases

**Al terminar cada fase:** ejecuta los tests, pruébala en el navegador integrado, pasa `qa-tester` y `code-reviewer`, corrige lo que encuentren, actualiza `PROGRESS.md` y **para**. Muéstrame un resumen, qué probar y cómo arrancarlo, y **espera mi visto bueno** antes de pasar a la siguiente.

| Fase | Contenido | Criterio de aceptación |
|---|---|---|
| **0. Preparación** | Proyecto Vite + Three.js, `launch.json`, agentes, `CLAUDE.md`, estructura de carpetas, panel de depuración. En paralelo, `asset-scout` hace un catálogo de assets CC0 candidatos (sin descargar todavía) para que yo lo apruebe. | `npm run dev` muestra una escena vacía con la cámara inclinada; el catálogo de assets está listo para revisar. |
| **1. Núcleo jugable** | Comisaría en blockout (cajas), policía con movimiento y cámara, pistola, zombi caminante con flow field, vida, muerte y reinicio. | Puedo moverme, disparar y morir; los zombis rodean los obstáculos y me persiguen. |
| **2. Día/noche y oleadas** | Ciclo completo, escalado de oleadas, puntos, combos, HUD básico, linterna y oscuridad nocturna. | Una partida de 3 noches es jugable de principio a fin. |
| **3. Construcción** | Modo construcción, barricadas con vida, reparación y mejora; zombis que atacan estructuras; pinchos, cepo y minas. | Si encierro la base, los zombis rompen la barricada más débil. |
| **4. Tiendas** | Armería, enfermería y almacén físicos; todas las armas con sus mejoras; botiquines, chaleco y granadas; recargo nocturno. | Puedo comprar y mejorar todo; la economía da para elegir, no para comprarlo todo. |
| **5. Enemigos y defensas completos** | Corredor, tanque, explosivo, escupidor y el jefe Antidisturbios; el resto de trampas, el generador, la valla eléctrica, la torreta, los focos y el señuelo. | Cada zombi obliga a una respuesta distinta. La noche 5 trae al jefe. |
| **6. Arte y sonido** | Sustituir el blockout por los assets CC0 aprobados, animaciones, comisaría final, iluminación nocturna completa, partículas, audio y música. | Se ve y suena como un juego, no como un prototipo, y mantiene los 60 FPS. |
| **7. Meta-progresión y menús** | Medallas, tablón de mejoras, récords, menús completos, opciones y guardado. | Las mejoras persisten entre partidas y al recargar la página. |
| **8. Controles y pulido** | Gamepad, controles táctiles, ajustes de calidad, optimización, equilibrado con `balance-analyst` y pulido de las sensaciones (game feel: retroceso, sacudida de cámara, impactos). | Se juega bien con teclado, con mando y en el móvil; la curva de dificultad hace que llegar a la noche 10 sea un reto. |

---

## 7. Cómo quiero que trabajes
- Antes de la fase 0, presenta un **plan breve**: arquitectura, lista de agentes y cualquier duda que tengas sobre este documento. Si algo es ambiguo, **pregunta en vez de suponer**.
- Prioriza que el juego **sea divertido y funcione** en cada fase antes que añadir cosas. Si una decisión de diseño de este documento te parece mala para la jugabilidad o el rendimiento, dímelo y propón una alternativa.
- El código debe ser legible y modular, con comentarios en español solo donde aporten algo.
- No des nada por terminado sin haberlo probado en el navegador.
