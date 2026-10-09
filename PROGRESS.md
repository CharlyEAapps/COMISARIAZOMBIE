# Progreso

| Fase | Estado |
|---|---|
| 0. Preparación | ✅ Hecha |
| 1. Núcleo jugable | ✅ Hecha |
| 2. Día/noche, oleadas, decoración e interacciones | ✅ Hecha |
| 3. Construcción, trampas y transformador | ✅ Hecha |
| 4. Tiendas y armas | ✅ Hecha |
| 5. Enemigos y defensas completos | ✅ Hecha |
| 6. Arte y sonido | ✅ Hecha |
| 7. Meta-progresión y menús | ✅ Hecha (pendiente del visto bueno de Carlos) |
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

## Fase 3: qué hay
- **Modo construcción (B):**
  - Barra de 6 piezas, pieza fantasma verde o roja, anillo de alcance de 10 m y radio visible de la mina.
  - Clic para construir (arrastrar hace una fila) o para reparar y mejorar.
  - Clic derecho dos veces para vender, que devuelve el 50 %.
  - De noche todo cuesta un 50 % más, también reparar.
- **Piezas:**
  - Barricada: madera, metal y hormigón.
  - Sacos de arena: sencillos y dobles; dejan pasar tus balas.
  - Puerta reforzada: cubre el hueco de puerta entero (doble hoja en los huecos de 2), con coste y vida por celda. Cerrada bloquea a todos; abierta deja pasar a todos y no recibe daño. Se abre y se cierra con E.
- **Trampas:**
  - Pinchos: daño por ticks, ralentizan y se desgastan.
  - Cepo: inmoviliza, se rearma solo y tiene usos limitados.
  - Mina: radio de 2,8 m, sin dañar a través de muros; también te hiere a ti.
- **IA:**
  - Las piezas bloquean el paso de los zombis y las balas, y encarecen sus rutas en proporción a su vida.
  - Los zombis golpean lo que les cierra el paso y eligen el camino más barato, normalmente la pieza más débil.
  - Las barricadas en diagonal no dejan rendijas.
- **Transformador (sustituye al generador):**
  - Tiene 700 de vida y da luz a la comisaría.
  - Desde la noche 2, alrededor del 25 % de los zombis son vándalos que van a por él. Hay aviso al primer golpe y al romperse.
  - Se repara con E, por un coste según el daño.
- **QA (Sonnet) y revisión (Opus) hechas.** Corregidos:
  - Paso por la esquina entre barricadas en diagonal.
  - Mina que empujaba zombis a través de puertas y muros y dañaba a través de paredes.
  - Reparar, mejorar y vender a cualquier distancia y venta sin confirmación.
  - Cepo reforzado que se rearmaba antes de tiempo.
  - Reparación sin recargo nocturno y fuga en la economía al reparar antes de vender.
  - Pinchos que hacían parpadear al zombi.
  - Recálculos de rutas innecesarios con las trampas.
  - Textos del antiguo generador y hoja de la puerta doble en mitad del paso.
- **Equilibrado:**
  - Sacos: 200/450 de vida, 35/70 puntos.
  - Pinchos: se desgastan 2,5 por segundo.
  - Cepo: 45 de daño y 3,5 s de rearme.
  - Transformador: 700 de vida, vándalos desde la noche 2.
  - Reparar: factor de coste 1,0 y espera de 1,5 s.

## Fase 4: qué hay
- **Tiendas físicas** (E en el mostrador; 1-9 o clic para comprar; E, Esc o alejarse para cerrar). No pausan el juego; de noche, +50 %.
  - **Armería:**
    - Escopeta, subfusil, fusil (atraviesa 2), rifle de precisión (atraviesa 3), táser (aturde y salta en cadena) y porra (cuerpo a cuerpo).
    - Munición con tope (se cobra en proporción si casi está lleno) y granadas (máx. 5).
    - 3 mejoras por arma. Táser: aturdimiento, saltos y recarga. Porra: solo daño.
  - **Enfermería:** botiquín, atención médica, chaleco (absorbe el 60 %, se paga lo que falta) y +40 de vida máxima ×3.
  - **Almacén:**
    - Al empezar solo barricada y sacos de madera.
    - Desbloquea puertas, pinchos, cepos, minas, metal, hormigón, blindadas y niveles 2.
    - Kit para reparar todo con −30 %, respetando la espera de reparación.
- **Armas con modelo propio en la mano** (7, procedurales). Las de dos manos llevan el brazo izquierdo al guardamanos; la porra tiene animación de golpe.
- **Granadas (G):** vuelo parabólico, pasan por encima de lo bajo, parpadean antes de explotar y no atraviesan muros.
- **HUD:** tira de armas con su tecla, granadas, botiquines y barra de armadura.
- **QA (Sonnet) y revisión (Opus) hechas.** Corregidos:
  - B con la tienda abierta.
  - Fogonazo del táser saliendo de un zombi y cadena del táser atravesando muros.
  - Granadas que chocaban con tus sacos o se perdían dentro de un muro.
  - Clics perdidos en la tienda y tienda anterior visible un instante al reabrir.
  - Kit de reparación sin espera.
  - Compras parciales cobradas enteras.
  - Lista que se reordenaba al comprar.
  - Panel que tapaba al jugador en pantallas estrechas.
- **Equilibrado:**
  - Subfusil: 18 de daño y 5° de dispersión.
  - Escopeta: 13° de dispersión.
  - Rifle de precisión: atraviesa 3, cuesta 1500.
  - Fusil: atraviesa 2, cuesta 1200.
  - Porra: más lenta, cuesta 250.
  - Mejoras de pistola: más caras.
  - Atención médica: 160 puntos.
  - Vida máxima: +40 por 250.

## Fase 5: qué hay
- **Zombis nuevos** (cuerpo por tipo y accesorios procedurales):
  - Corredor (noche 2, en manadas), escupidor (noche 3, ácido en arco con charcos), explosivo (noche 3, revienta en cadena y daña construcciones) y tanque (noche 4, ×3 a construcciones y empuja).
  - Jefe Antidisturbios cada 5 noches (a los 25 s): casco, escudo frontal que para balas, porra, táser y torretas; explosivos ×2; barra de vida en el HUD; +35 % de vida por aparición.
  - Aviso al aparecer cada tipo por primera vez, de uno en uno.
- **Defensas nuevas** (barra de construcción en 2 páginas, Tab): alambre de espino, barril explosivo, valla electrificada + generador, torreta automática (recarga con E) y foco. Desbloqueos en el almacén.
- **IA:** los vándalos van al transformador y a los generadores (flow field con varios objetivos). Los zombis grandes usan rutas "anchas" (bloques libres de 2×2) y apuntan al centro del hueco para no clavarse en los muebles.
- **QA (Sonnet), revisión (Opus) y equilibrado (Sonnet) hechos.** Corregidos:
  - Jefe y tanque atascados en puertas y entre muebles (además, a petición de Carlos, ahora son más pequeños).
  - Empujón del jefe que atravesaba vallas finas (movimiento en subpasos).
  - Rutas de los vándalos obsoletas al romper o reparar el transformador.
  - Mejora de torreta que recargaba gratis; torretas que gastaban munición contra el escudo; sus balas ahora detonan barriles.
  - Vallas que no electrocutaban a zombis grandes; focos juntos que quemaban la imagen.
  - Avisos tapados por la barra de construcción, barra del jefe en pantallas estrechas, banner del jefe pisado por el de la noche, texto del requisito de las vallas.
  - Números mágicos llevados a JSON, `dispose` de los zombis y asignaciones en bucles calientes.
- **Petición de Carlos:** la horda sale entera al empezar la noche (con el tope de vivos) y la noche termina en cuanto la abates, sin esperar al reloj.
- **Equilibrado:** el peso de los corredores cuenta zombis, no manadas (antes eran la mitad de la horda); horda ×1,06 por noche; tanque 110 puntos; jefe 800 puntos, +35 % por aparición; vallas 20/31 de descarga; torreta 500, 200 balas, 0,5 por bala; barril 80.

## Fase 7: qué hay
- **Guardado** (`src/save/SaveStore.js`): esquema versionado en `localStorage`, validado al cargar y envuelto en try/catch. Si el almacenamiento falla, el juego sigue sin guardar y lo avisa.
- **Meta-progresión** (`src/systems/Meta.js`, `src/data/meta.json`):
  - Medallas por noche, hitos y logros.
  - 8 mejoras permanentes con niveles y coste creciente, que se aplican al empezar cada turno.
  - Top 10 de récords y estadísticas totales.
- **Menús** (`src/ui/Menus.js`): principal, tablón, récords, opciones (volúmenes, calidad, temblor y borrar progreso), controles, pausa (con abandonar) y resumen de fin de turno. Esc vuelve atrás y Enter juega o reintenta.
- **QA (Sonnet) y revisión (Opus) hechas.** Corregidos:
  - Niveles de mejora del guardado sin tope, que daban precios negativos o rompían el tablón.
  - Récords por saldo en vez de por puntos ganados (ahora `run.score`); los turnos sin puntos ni noches no entran.
  - Pantalla de fin a prueba de fallos y abandono que podía contar dos veces o quedarse "armado".
  - Aviso de "no se puede guardar" (se comprueba con una escritura de prueba).
  - Tabla de récords en móvil, HUD visible tras el resumen y animación de recarga con la mejora.
  - Tab y Esc en los menús, textos de las mejoras generados con los valores reales y CSS.

## Fase 6: qué hay
- **Audio** (`src/audio/`, `src/data/audio.json`):
  - Efectos posicionales con `THREE.PositionalAudio`: el oyente va sobre el policía, orientado como la cámara. Además hay voces planas para la interfaz.
  - Límites de voces por sonido, normalización de volumen y audio suspendido con la pestaña oculta.
  - ~55 efectos sintetizados por código (disparos de cada arma, recargas, explosiones, trampas, valla, ácido, interfaz, radio…) y 71 clips CC0: gruñidos de zombi, rugido del jefe, sirena, pasos y golpes por material (madera, metal, hormigón, sacos).
  - Música CC0 con melodía: día (*Forget Me Not*), noche (*Zombies' March*) y jefe (*8bit Action Boss Battle*), con fundido cruzado.
  - Volúmenes de música, efectos y general en la pausa, guardados en el navegador. Créditos en `CREDITS.md`.
- **Partículas, calcomanías y animaciones:**
  - Casquillos, humo y chispas de boca, e impactos en los muros.
  - Zombis que reaccionan al impacto y caen en su dirección; manchas que se desvanecen.
  - Explosiones con onda, humo, brasas y quemado; escombros según el material.
  - Policía: recarga animada, retroceso, respiración, gesto de dolor e inclinación al esprintar, con polvo al correr.
  - Los shaders se compilan al arrancar.
- **HUD:** la ayuda y los avisos de acción van apilados, los toasts arriba a la derecha en pantallas estrechas (máximo 3) y no hay solapes de 414 a 1400 px.
- **Peticiones de Carlos:**
  - La horda sale entera y la noche acaba al abatirla (con prórroga máxima de 90 s si algo se atasca).
  - Torretas sin límite.
  - Humor negro en todo el juego.
- **QA (Sonnet) y revisión (Opus) hechas.** Corregidos:
  - Volumen, tono y posición de las voces reutilizadas, que se deslizaban.
  - Sirena del señuelo sin sonido y rugido de muerte del jefe que se perdía.
  - Respaldo sintetizado de los gruñidos.
  - Contexto de audio compartido que no se cerraba al liberar.
  - Volúmenes guardados sin validar.
  - Clic de torreta vacía en cada paso.
  - Voces que seguían sonando al reiniciar.
  - Ráfagas antiguas duplicadas con los efectos nuevos.
  - Banner sobre la barra de construcción y tirón del primer disparo.

## Humor negro (petición de Carlos, tras la fase 5)
Tono ácido sin gore. Todo el texto en `src/data/humor.json` (más frases en tienda, pizarra y llamadas):
- **Radio de la central:** comentarios irónicos cada 35-55 s de noche y uno al empezar cada día; avisos del jefe, transformador, generador y torreta con coletilla.
- **Zombis:** de vez en cuando sueltan una frase al caer (por tipo); el jefe lleva nombre y "hoja de servicios" en su barra y su banner; presentaciones de cada tipo con humor.
- **Tienda:** cada arma, artículo de enfermería y desbloqueo del almacén lleva una coletilla.
- **Amanecer y muerte:** parte de servicio irónico con las bajas de la noche, y esquela/informe al caer.
- **Comisaría:** carteles "Se ruega no morder al personal" y "Llevamos 0 días sin incidentes", mostradores "(solo vivos)" y "solo con cita previa", carteles de "Se busca" con delitos de poca monta, casos de la pizarra y 5 llamadas nuevas al teléfono.

## Placeholders pendientes de sustituir
- Arte: todo procedural en el estilo de la referencia (decisión de Carlos). Los packs CC0 solo se usarán para sonido y música (fase 6).
- Trampas, barricadas y armas: se modelarán por código en sus fases.

## Ideas de Carlos (backlog)
- ✅ (fase 2, hecha) **Cafetera:** +10 % de velocidad de movimiento durante 30 s; 2 min de espera hasta el siguiente café.
- ✅ (fase 3) **Transformador con vida**, que sustituye al generador:
  - Funciona desde el inicio y, de noche, da más luz a la comisaría.
  - Los zombis pueden estropearlo; sin él, solo queda la linterna.
  - Se puede reparar en cualquier momento (coste proporcional al daño).

## Bugs conocidos
- Ninguno.
