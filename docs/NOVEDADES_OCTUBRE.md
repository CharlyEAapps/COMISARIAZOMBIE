# Novedades pedidas por Carlos (11/10/2026)

Cinco frentes en paralelo, cada uno con un agente. Cada frente tiene **sus archivos**. Si necesitas tocar
un archivo de otro frente o uno compartido, hazlo con ediciones pequeñas y localizadas (Edit),
**nunca reescribiendo el archivo entero**, porque otros agentes lo están editando a la vez.
Archivos compartidos: `src/core/Game.js`, `src/ui/Hud.js`, `src/ui/style.css`, `src/data/config.json`,
`src/data/station.json`, `src/data/shop.json`, `src/audio/Synth.js`, `src/data/audio.json` y `CREDITS.md`.

## Reglas comunes
- Lee `CLAUDE.md`. Carlos juega sobre todo en **iPhone en horizontal** con controles táctiles, así que todo lo nuevo de HUD y controles tiene que caber y funcionar a 740×360 y 667×330 sin tapar los botones táctiles (ver `src/input/TouchControls.js` y `.touch` en `style.css`).
- **El policía se llama Carlos.** Su mujer es **Ana** y su hijo **Oliver**, de 6 años.
- Humor negro ácido **sin gore**, en español de España, como el resto del juego (`src/data/humor.json`).
- Todo el equilibrado va en `src/data/*.json` y nada de números mágicos en la lógica.
- Sin asignaciones por frame. Con cada geometría que se quite, `dispose`.
- Tests:
  - Añade tests en `tests/` para tu lógica.
  - `npx vitest run` y `npm run build` tienen que quedar en verde con TUS cambios. Si falla un test de otro frente por un cambio a medias suyo, dilo en el informe, pero no lo "arregles" tocando su código.
- No hagas commit ni push: lo hace el director.
- Prueba en el navegador:
  - No tienes las herramientas del navegador integrado. Usa un Chrome o Edge sin ventana controlado por script, con `npm run dev` en 5173 (si ya está levantado, úsalo y no lo mates).
  - Otros agentes editan a la vez, así que Vite puede recargar la página a mitad de prueba: reintenta.
  - Haz capturas en 1280×720 y 740×360 táctil, comprueba `gl.getError() === 0` y que la consola quede limpia.
  - Guarda las capturas en `C:\Users\alben\AppData\Local\Temp\claude\C--Users-alben-Documents-JUEGO-PROPIO\0d87096f-d5ea-4e05-9846-38c2c1ac46bd\scratchpad\shots3\<frente>_*.png`.
  - Al acabar, cierra los navegadores que hayas abierto.
- Informe final breve en español:
  - Qué hay.
  - Cómo se usa.
  - Archivos tocados.
  - Tests.
  - Lo que no se haya podido hacer.

---

## Frente A: Mejoras de base (Despacho del jefe)
**Archivos propios:**
- `src/systems/Despacho.js`, `src/data/despacho.json` y `src/render/DespachoRenderer.js`.
- Nuevos: `src/entities/Luigi.js`, `src/render/LuigiRenderer.js` y `src/systems/Barrels.js`, o los nombres que elijas.
- Además, `src/data/map.json` y `tools/genmap.cjs` solo para el sitio de las torres nuevas.

1. **Persianas blindadas con sensor:**
   - Desde que se compran, las puertas metálicas del edificio están **siempre cerradas**, y **se abren solas** cuando Carlos se acerca a 1,5 m. Se cierran cuando deja de haber alguien en el hueco.
   - Si le siguen zombis, no se cierran mientras haya zombis pasando.
   - Los zombis por sí solos no las abren: tienen que romperlas.
   - Funciona de día y de noche. El cierre espera unos 0,6 s con el hueco libre (dato en JSON).
   - Los portones de la valla siguen como ahora: abiertos de día y cerrados de noche.
2. **Torre de vigilancia, nivel III (nuevo, el superior):**
   - Además de la torre del patio, pone una **torreta de nivel 1 sobre una torre** junto a **cada uno de los 3 accesos de la valla**: oeste (8, 10-13), este (71, 24-27) y sur (30-33, 64). Las torres van dentro de la valla, pegadas al acceso, sin taparlo.
   - Si donde va una torre hay algo construido por el jugador, se elimina devolviendo lo invertido. Si hay mobiliario del mapa, quítalo del mapa ya (que el sitio quede libre siempre).
   - Las torres tienen colisión.
   - La torre es la de `torre_vigilancia` en `src/render/props/outdoor.js`. Reutilízala desde el render del despacho, solo visible con la mejora.
3. **Barriles explosivos (mejora nueva, en el patio):**
   - Barriles rojos con su símbolo repartidos por el parking: 6 en el nivel I y 10 en el II. Se **reponen cada anochecer**.
   - Si les disparas (o les da una granada o una explosión), **explotan**. Daño en área a zombis; también a Carlos si está cerca, que se vea el peligro.
   - Reutiliza `src/systems/Explosions.js`. Los barriles bloquean el paso y se pueden apuntar con la asistencia de apuntado táctil.
4. **Luigi, el chihuahua (mejora nueva, en la sala de descanso, que ahora no tiene mejoras):**
   - Perrito marrón claro "de bloques" (estilo `BlockyCharacter`), animado: trote, ladrido y saltito al morder.
   - Va cerca de Carlos. Cuando un zombi se acerca a unos 4 m de Carlos, corre a morderle: poco daño, unos 6 por mordisco cada 0,8 s.
   - **No puede morir.** Los zombis le ignoran o, si le pegan, no le pasa nada (se aparta con un gañido gracioso).
   - Vuelve con Carlos si se aleja más de 8 m.
   - En la sala de descanso se ve su cama con su nombre y, con la mejora, Luigi en el mapa.
   - Nivel II opcional: "Luigi con chaleco", más daño y a veces aturde.
   - Frases de humor sobre Luigi en la tienda.
- Todo con precio en el rango 300–1.500, descripción por nivel, flavor de humor y guardado en "Continuar turno" (getState/setState).
- Actualiza los tests de `despacho` y `station`.

## Frente B: Armas nuevas
**Archivos propios:**
- `src/systems/WeaponSystem.js`, `src/data/weapons.json` y `src/render/WeaponModels.js`.
- `weapons-preview.html` y las partes de armería de `src/data/shop.json`.
- Los sonidos en `src/audio/Synth.js` y `src/data/audio.json`, añadiendo sin reescribir.

1. **Rifle láser con recalentamiento:**
   - Rayo instantáneo, munición infinita, pero cada disparo **calienta**. Si llega al 100 %, se **bloquea hasta enfriarse** del todo, con humo y un pitido.
   - Se ve la barra de calor en el HUD de escritorio y en el móvil (`.m-weapon`), en lugar de la munición.
   - Rayo visible (línea brillante) y atraviesa a 1-2 zombis.
2. **Lanzallamas:**
   - Cono corto (unos 5 m) de llamas en partículas, daño continuo y **los zombis se queman** unos segundos (daño por tiempo y brillo naranja).
   - Gasta combustible (munición) muy rápido. Sin gore: los zombis se tiznan.
3. **Sable láser (tipo jedi):**
   - Cuerpo a cuerpo con un arco amplio delante, mucho daño y la hoja brillante que se ve con el arma en la mano.
   - Zumbido al blandirlo y desvía los escupitajos del escupidor si apuntas hacia ellos (si es razonable de hacer).
   - Sin cortes gore.
- Las tres se venden en la armería, con precios y mejoras por arma (daño, cargador o calor, recarga o enfriamiento) en la línea de las demás. Dales nombres con humor (sin marcas reales) y frases de tienda.
- En el móvil, el cambio de arma (tocar `.m-weapon`) tiene que funcionar con las nuevas, y la asistencia de apuntado también.
- Tests de la lógica: calor y bloqueo, quemadura y arco del sable.

## Frente C: Historia por radio, llamadas familiares y final
**Archivos propios:**
- Nuevos: `src/systems/Story.js`, `src/data/story.json` y `src/data/familia.json`.
- `src/systems/Humor.js` y `src/data/humor.json`, solo donde haga falta.
- `src/ui/Menus.js`, solo para la pantalla final.

1. **Historia de 15 días por la radio**, con humor:
   - Guion propio: qué ha pasado, quién está detrás y por qué la comisaría del Distrito 13 sigue en pie. Personajes recurrentes de la central, el comisario ausente, el alcalde…
   - Cada día, mientras se espera la noche, la radio emite el "episodio" del día: varias líneas espaciadas durante el día.
   - Se muestra como subtítulo de radio (📻 nombre: texto) en un panel compacto que **no tape** la franja superior móvil, los botones ni los avisos. Deja que se lea a su ritmo y que se pueda pasar tocándolo.
   - Del día 1 al 15, con progresión y giros.
2. **Qué pasa al llegar al 15:** propón y aplica una solución.
   - Por ejemplo: la noche 15 es la gran noche (el jefe final de la trama) y, al amanecer del 16, llega el "rescate" con un giro de humor y una pantalla de final con resumen.
   - Después se puede **seguir jugando en modo infinito**: la radio pasa a reposiciones o boletines aleatorios.
   - La historia avanza con el turno y se guarda en "Continuar turno" (getState/setState, enlazado en `src/save/RunSave.js` con un cambio mínimo).
3. **Llamadas de Ana (la mujer de Carlos) y de Oliver (su hijo de 6 años):**
   - Como máximo **una por periodo**: una de día y/o una de noche, no siempre, con probabilidad en JSON.
   - Se ven como llamada entrante en el móvil (📱 Ana… / 📱 Oliver…) con la frase y la **respuesta de Carlos**, que es lo más gracioso.
   - **Al menos 50 variantes**, cada una con su respuesta, sin repetir hasta agotar.
   - De noche la llamada llega en el peor momento, con humor. Que no tape el juego más de lo necesario.
4. **El policía se llama Carlos:** que aparezca en los textos donde tenga sentido (radio, banners, esquela de game over…).

## Frente D: Misiones aleatorias originales
**Archivos propios:**
- `src/systems/Score.js` (objetivos) y `src/data/score.json`.
- Nuevos: `src/systems/Missions.js` y `src/data/missions.json`.
- La interacción `pizarra_casos`.

- Hoy los "casos de la pizarra" son solo contadores (bajas, daño, combo). Hay que hacer **misiones originales que cambien la partida**. Se aceptan en la pizarra de día y se cumplen esa noche, con recompensa. Ideas, desarrolla al menos 8:
  - **Apagón programado:** la noche empieza sin luz y hay que reparar el cuadro eléctrico.
  - **El concejal en la azotea:** un civil al que hay que mantener con vida en un punto del mapa.
  - **Recuperar las pruebas:** una caja que aparece en el parking y hay que llevar al almacén.
  - **Noche de niebla:** visibilidad reducida.
  - **Solo porra:** recompensa grande si solo usas cuerpo a cuerpo.
  - **Proteger el coche patrulla:** un coche con vida.
  - **El gato del comisario:** un gato suelto por el parking que hay que rescatar.
  - **Inspección de Hacienda:** no gastar puntos esa noche.
  - **Horda de antidisturbios.**
- Algunas son opcionales y otras llegan **forzadas** al azar (evento de la noche).
- Cada una con su texto de humor, su indicador en el HUD (compacto en el móvil), éxito o fracaso al amanecer y su recompensa.
- Reutiliza los sistemas que haya: luces del transformador, `WaveDirector`, `ZombieSystem` y el sistema de interacciones.
- Tests de cada misión: inicio, cumplimiento y fracaso.

## Frente E: Detalle visual de la comisaría y construcción
**Archivos propios:**
- `src/render/props/rooms.js`, `furniture.js`, `decor.js`, `common.js` y `Atlas.js`.
- `src/render/StructureModels.js` y `src/render/StructureRenderer.js`.
- Muebles y decoración de `station.json`, con ediciones localizadas, porque el frente A añade ids de mejoras en `rooms[].upgrades`.

1. **Más detalle en todas las salas**, en el estilo diorama de la referencia (ver CLAUDE.md):
   - Cuadros, plantas, papeleras, cables, enchufes, zócalos, rodapiés, persianas en las ventanas, tablones con notas, taquillas con nombres, etc.
   - Que cada sala se reconozca al primer vistazo desde la cámara del móvil.
2. **Armería:** armas **reconocibles** colgadas en la pared y en los armeros: escopetas, subfusiles, fusiles, pistolas, porras, chalecos, cajas de munición. Más llenas por nivel.
3. **Calabozos:** rediseñar las celdas. Que sean celdas de verdad: cada una con sus rejas frontales y su puerta de reja, catre, váter, lavabo y pasillo delante. Ahora están mal planteadas. Puedes ajustar el interior en `station.json` (furniture y tiles) y regenerar `map.json` con `tools/genmap.cjs`. Ojo: el frente A también toca `map.json`, solo en el exterior (torres junto a la valla). Coordina leyendo el archivo justo antes de regenerar y conserva sus cambios.
4. **Construcción menos tosca:**
   - Las vallas, barricadas y sacos **tienen que unirse bien en esquinas y en T**: postes compartidos y tramos que conectan con sus vecinos.
   - Mejor acabado de las piezas por nivel.
- Mantén el rendimiento: el `PropBuilder` combina por capas y las draw calls no deben subir mucho. Mide antes y después.
