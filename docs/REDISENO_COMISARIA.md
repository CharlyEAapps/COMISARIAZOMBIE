# Rediseño de la comisaría por salas con nivel (petición de Carlos, 10/10/2026)

> «Rediseña la comisaría con un diseño adaptable y con mejoras visibles cuando la vaya subiendo
> de nivel: calabozos, sala de archivos, recepción, armería, enfermería, despacho del jefe, vestuarios, etc.»
> Antes: «No veo cambios en el diseño de la comisaría ni veo el despacho del jefe».

## Por qué
El despacho actual era una mesa más en las oficinas, y las mejoras solo aparecían al comprarlas,
en sitios que no se ven a primera vista. Carlos quiere entrar en la comisaría y **reconocer cada sala**,
y que **cada mejora reforme su sala** a la vista: de cutre (nivel 0) a reformada (nivel máximo).

## Idea general
- **Edificio nuevo**, más grande y con salas reconocibles, cada una con su cartel en la puerta y en
  el pasillo, y suelo propio (no todo el damero igual).
- **Cada sala tiene un nivel** (0 = presupuesto municipal: cajas, cinta americana, una bombilla, goteras,
  muebles viejos). Al subirla de nivel cambia su aspecto **y** da una ventaja de juego.
- Las mejoras se compran en el **Despacho del jefe** (una sola tienda, cómodo en el móvil), agrupadas
  por sala. El cartel de cada sala muestra sus estrellas (★☆☆).
- En la fachada, un cartel «COMISARÍA DEL DISTRITO 13» con el **nivel global** de la comisaría
  (suma de niveles) y, al subirlo, la fachada mejora (pintura, rótulo luminoso, placas de acero).
- «Adaptable»: salas modulares definidas en datos (`src/data/station.json`): rectángulo, puertas, suelo,
  cartel y piezas por nivel. Mover o añadir una sala no exige tocar código.
- Mejoras por turno (se pierden al caer, igual que ahora) y guardadas en «Continuar turno».

## Salas (todas con cartel, suelo propio y nivel)
| Sala | Nivel 0 (cutre) | Mejoras (efecto · lo que se ve) |
|---|---|---|
| **Recepción** (entrada principal sur, inicio del jugador) | Mostrador con cinta, sillas rotas, fluorescente que parpadea | **Persianas blindadas I-III** (las actuales, en todos los accesos exteriores) · mostrador con cristal blindado, persianas visibles enrolladas sobre cada acceso de día |
| **Despacho del jefe** (mesa del comisario = tienda de mejoras, con «!» como las demás tiendas) | Mesa de saldo, flexo, calendario viejo | **Cámaras de seguridad I-II** (I: avisos de amenaza más lejos; II: + minimapa/radar de zombis especiales o similar sencillo) · pared de monitores que crece; maqueta de la comisaría en una mesa que refleja el nivel global |
| **Sala de archivos** | Cajas apiladas, papeles por el suelo | **Archivo I-II** (I: el radar actual, «la horda llega por el X»; II: los casos de la pizarra dan +50 % de puntos) · estanterías ordenadas y, en II, armario de servidores con luces |
| **Armería** | Armero medio vacío | **Armería I-III** (descuento en munición 10/20/30 % y, en III, recarga gratis de munición al amanecer) · más armeros llenos, banco de trabajo, puerta de cámara acorazada |
| **Enfermería** | Una camilla, botiquín vacío | **Enfermería I-III** (I: botiquines de pared también de noche (el actual); II: estar dentro cura poco a poco; III: +1 botiquín al amanecer) · más camillas, monitores con pulso, cortinas, cruz luminosa |
| **Calabozos** | Rejas oxidadas | **Calabozos I-II** (suelo electrificado: los zombis que entran reciben daño por segundo; II más daño y los aturde) · rejas pintadas, cartel de alta tensión, suelo con chispas |
| **Vestuarios** (con duchas y taquillas, que ya dan objetos) | Taquillas abolladas | **Vestuarios I-II** (I: chaleco parcial gratis al amanecer; II: taquillas con mejor botín y +aguante) · taquillas nuevas, duchas, chalecos colgados |
| **Almacén** (tienda de construcción actual) | Estanterías | **Muros reforzados I-II** (el actual) · estanterías con planchas de acero y sacos |
| **Patio / sala de máquinas** | Transformador pelado | **Transformador I-III**, **Generador de emergencia**, **Focos del patio** (los actuales y sus modelos) |
| **Azotea** | Nada | **Torreta del tejado I-II**, **Alarma mejorada** (las actuales y sus modelos) |
| Pasillo central y sala de descanso (cafetera, máquina expendedora, fuente) | — | Sin nivel propio, son paso |

Los precios de partida son los del despacho actual. Las mejoras nuevas cuestan entre 300 y 1.500, con
textos de humor negro ácido sin gore, como el resto.

## Restricciones de diseño
- **Móvil primero.** En el iPhone (cámara táctil a 19 m) hay que poder moverse y disparar:
  - Salas de al menos 7×6 celdas.
  - Pasillos de 4 celdas.
  - Puertas interiores de 2 celdas.
  - Los zombis grandes usan `WideFlowField` (2×2): nada de pasos de 1 celda en rutas obligatorias.
- **Accesos exteriores:** 3 o 4 (sur, este, oeste y quizá norte), siempre de 2 celdas, para que funcionen
  las persianas (`exteriorDoorGroups`) y las rutas de la horda.
- **Tamaño del edificio:** puede crecer dentro de la valla, aproximadamente de x 14 a 65 y de z 11 a 39.
  Hay que recolocar lo que choque: aparcamiento, mástiles, transformador, árboles, contenedores y farolas.
- **Fuentes únicas:**
  - Las colisiones salen siempre de `NavGrid.buildCollisionBoxes()`.
  - Las salas se definen en datos; `PropFactory.ROOMS` y `layout.js` deben salir de esos datos o actualizarse.
- **Nada de números mágicos en la lógica:** todo en `src/data/*.json`.
- **Rendimiento:**
  - Las piezas de cada nivel se construyen con el `PropBuilder` (geometría combinada por capas).
  - Al subir de nivel se reconstruye solo esa sala y se liberan (`dispose`) la geometría y los materiales viejos.
  - Nada de asignaciones por frame.
- **Guardado:**
  - Subir `RUN_SAVE_VERSION` a 2: las construcciones antiguas no encajan en el mapa nuevo.
  - El estado de las salas se guarda y se restaura con `getState()` y `setState()`, antes de las construcciones.
- Hay que mantener todo lo que ya funciona:
  - Interacciones: pizarra de casos, teléfono, cafetera, máquina expendedora, fuente, taquillas, archivadores, botiquines de pared, cuadro eléctrico, ordenador de cámaras, alarma, radio y coche con sirena.
  - Las 4 tiendas.
  - Puntos de aparición, luces de cada sala, recortes de muros (`Cutaway`), medallas, casos y humor.
- Con cada cambio:
  - Actualizar los tests que dependan del mapa (`map`, `props`, `build`, `despacho`).
  - Añadir tests de las salas: datos válidos, todas conectadas, puertas de 2 celdas y efectos por nivel.

## Verificación obligatoria
- `npx vitest run` en verde y `npm run build` sin errores.
- Capturas en escritorio y en móvil emulado (740×360 táctil):
  - Cada sala a nivel 0 y a nivel máximo, de día y de noche.
  - `gl.getError() === 0` y la consola limpia.
- Simular varias noches con `__game.simulate()`:
  - Los zombis normales y los grandes (tanque y jefe) llegan al jugador desde todos los accesos y no se atascan.
  - Las persianas se colocan en todos los accesos.
- Continuar turno: guardar con salas mejoradas, recargar, continuar y comprobar que se ve igual.
