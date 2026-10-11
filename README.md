# Turno de Noche

Supervivencia zombi en 3D low-poly para el navegador. Eres un policía que defiende su comisaría: de día preparas la defensa y de noche aguantas la horda.

## Arrancar
```bash
npm install
npm run dev
```
Después abre http://localhost:5173.

## Cómo se juega
De día preparas la comisaría; al anochecer suena la sirena y llega la horda. Al caer la noche sale toda la horda de golpe (con un tope de zombis vivos a la vez; el resto entra según caen) y la noche termina en cuanto no queda ninguno. Cada noche hay más zombis, más rápidos y más resistentes. Al amanecer cobras un bonus (más si no te han tocado o si has resuelto el caso de la pizarra).

## Controles
| Tecla | Acción |
|---|---|
| WASD / flechas | Mover |
| Ratón | Apuntar (la cámara se adelanta hacia el cursor) |
| Clic izquierdo | Disparar |
| R | Recargar |
| 1-0 | Cambiar de arma (pistola, escopeta, subfusil, fusil, rifle de precisión, táser, porra, rifle láser, lanzallamas, sable láser) |
| G | Lanzar granada hacia el cursor |
| Shift | Correr (gasta resistencia) |
| E (mantener) | Interactuar con lo que tengas delante |
| Q | Usar botiquín |
| N | Empezar la noche ya (de día) |
| B | Modo construcción (Tab cambia entre Defensas y Trampas · 1-7 eligen pieza · clic construye/repara/mejora · arrastrar = fila · clic dcho ×2 vende · clic dcho en vacío sale) |
| Rueda | Zoom |
| Esc | Pausa / volver (en la pausa: continuar, opciones, controles o abandonar el turno) |
| Enter | Reintentar tras morir |
| F1 | Panel de depuración (modo dios, saltar a la noche, generar zombis, ver flow field…) |

## Tiendas (E en el mostrador · 1-9 o clic para comprar · E/Esc para cerrar)
De noche, todo cuesta un 50 % más. La tienda no pausa el juego.

| Tienda | Qué vende |
|---|---|
| 🔫 Armería | Escopeta, subfusil, fusil de asalto, rifle de precisión (atraviesa), táser (aturde en cadena) y porra (cuerpo a cuerpo). Munición, granadas y 3 mejoras por arma (daño, cargador y recarga) |
| 🏥 Enfermería | Botiquines, curación completa, chaleco antibalas (absorbe el 60 % del daño) y +25 de vida máxima (×3) |
| 📦 Almacén | Desbloquea puertas, pinchos, cepos, minas y los niveles de metal, hormigón y blindado. Kit para reparar todo con descuento |

Al empezar solo puedes construir barricadas y sacos de madera.

### 🗄️ Despacho del comisario (mesa del comisario, en las oficinas)
Mejoras de la comisaría para el turno en curso, todas visibles en el mapa:
- **Seguridad:** persianas blindadas automáticas en los 3 accesos cada noche (I-III) y muros reforzados (+vida a todo lo construido).
- **Energía:** transformador reforzado (más vida y se repara solo de día, I-III), generador de emergencia (60 s de luz si cae el transformador) y focos del patio.
- **Vigilancia:** radar (avisa por dónde llega la horda y el jefe) y cámaras (los indicadores de amenaza llegan más lejos).
- **Apoyo:** torreta del tejado (I-II), alarma mejorada y botiquines de pared extra.

## Construcción y trampas (tecla B)
| Pieza | Niveles | Notas |
|---|---|---|
| 🧱 Barricada | Madera → Metal → Hormigón | Bloquea el paso y las balas |
| 🪨 Sacos de arena | Sacos → Sacos dobles | Bloquean a los zombis, pero tus balas pasan por encima |
| 🚪 Puerta reforzada | Seguridad → Blindada | Cubre el hueco de puerta entero (coste y vida por celda). Cerrada no pasa nadie, tú tampoco: ábrela y ciérrala con E. Abierta pasan todos y los zombis la ignoran (no la dañan) |
| 📌 Pinchos | Madera → Acero | Daño continuo y ralentizan; se desgastan |
| 🪤 Cepo | Normal → Reforzado | Inmoviliza unos segundos y se rearma solo (usos limitados) |
| 💣 Mina | — | Explota una vez; ¡también te daña si estás cerca! |
| ➰ Alambre de espino | Espino → Concertina | Frena mucho y hace algo de daño; se desgasta |
| 🛢️ Barril explosivo | — | Dispárale (o deja que lo golpeen) y estalla; encadena con otros barriles. ¡También te daña! |
| ⚡ Valla electrificada | Normal → Reforzada | Bloquea; con un generador en pie, electrocuta y aturde a quien la toque. Tus balas pasan |
| 🔋 Generador | — | Da corriente a las vallas. Atrae a los vándalos |
| 🎯 Torreta automática | Torreta → Pesada | Dispara sola al zombi más cercano. Munición limitada: recárgala pagando (E / ✋ junto a ella). Sin límite, pero cada torreta extra cuesta un 25 % más |
| 💡 Foco | — | Ilumina una zona de noche |

- Los zombis golpean lo que les cierra el paso. Si encierras la base, eligen el camino más barato (la pieza más débil o la más cercana).
- Reparar cuesta en proporción al daño; vender (dos clics derechos) devuelve el 50 % de lo invertido según la vida que le quede. De noche todo cuesta un 50 % más, también reparar. Solo puedes actuar sobre piezas a menos de 10 m.
- **Transformador** (patio norte): da luz a la comisaría. Desde la noche 2, algunos zombis (vándalos) van a por él; avisa cuando lo atacan. Si lo rompen, te quedas solo con la linterna. Repáralo con E.

## Zombis
| Tipo | Desde | Cómo hacerle frente |
|---|---|---|
| Caminante | Noche 1 | La base de la horda |
| Corredor | Noche 2 | Rápido y frágil, llega en manadas: construye y no te dejes rodear |
| Escupidor | Noche 3 | Lanza ácido por encima de los sacos y deja charcos que queman y corroen: muévete y cázalo primero |
| Explosivo | Noche 3 | Revienta al morir o al alcanzarte y rompe barricadas: abátelo de lejos (o junto a sus amigos) |
| Tanque | Noche 4 | Mucha vida, triple de daño a las construcciones y te empuja: fuego concentrado, trampas y distancia |
| **Jefe Antidisturbios** | Cada 5 noches | Escudo frontal que para balas, porra, táser y torretas: rodéalo o usa explosivos (le hacen el doble). Barra de vida propia; la noche no acaba hasta abatirlo |

## Interacciones de la comisaría
| Objeto | Efecto |
|---|---|
| ☕ Cafetera | +10 % de velocidad durante 30 s (2 min de espera) |
| 🍫 Máquina de vending | +15 de vida por 25 puntos |
| 💧 Fuente de agua | +8 de vida |
| 🗄️ Taquillas | Botiquín, dinero… o calcetines sucios (una vez por día) |
| 📁 Archivadores | Puntos por expedientes o información sobre la horda (una vez por día) |
| 🩹 Botiquín de pared | +1 botiquín (una vez por día) |
| 🛏️ Camas de la enfermería | +30 de vida y saltar hasta el anochecer |
| 📞 Teléfono | Llamadas variopintas; a veces, ayuda |
| 📻 Radio | Previsión de la horda: cuántos y por dónde |
| 📹 Cámaras | Cuántos zombis hay y por dónde vienen |
| ⚡ Transformador (patio) | Repararlo si está dañado (coste según el daño) |
| 💡 Cuadro eléctrico | Enciende o apaga las luces de la comisaría (necesita el transformador) |
| 📋 Pizarra de casos | Objetivo para la noche con recompensa |
| 🚓 Coches patrulla | La sirena atrae a los zombis cercanos durante 10 s |
| 🚨 Alarma | Luces de emergencia y zombis más lentos durante 20 s (una vez por noche) |

## Menús, medallas y récords
- **Menú principal:** empezar el turno (Enter), Tablón de la comisaría, Récords, Opciones y Controles.
- **Medallas:** al acabar cada turno ganas medallas por noche sobrevivida, hitos (3, 5, 10 y 15 noches) y logros (jefe abatido, 100/300/600 bajas, combo de 30, noches sin un rasguño, casos resueltos, 25 construcciones, 5 armas usadas).
- **Tablón de la comisaría:** mejoras permanentes que se compran con medallas: vida máxima, puntos iniciales, botiquines, empezar con escopeta, descuento en la armería, recarga más rápida, linterna más potente y barricadas gratis al empezar.
- **Récords:** los 10 mejores turnos (puntos, noches, bajas, tiempo, arma favorita y fecha).
- **Fin de turno:** resumen con bajas por tipo, arma favorita, mejor combo, medallas ganadas y si has entrado en los récords. Desde la pausa también puedes abandonar el turno (cuenta como terminado).
- **Continuar turno:** al amanecer (desde el día 2) se guarda el turno en curso. Desde el menú principal puedes seguir donde lo dejaste; al caer o abandonar se borra.
- **Iniciales de recreativa:** si entras en los récords, escribes tus 3 iniciales. Cada móvil guarda su propio progreso, medallas y turno.
- **Indicadores de amenaza:** flechas en el borde de la pantalla hacia los zombis especiales y el jefe fuera de cámara, y destello rojo en el lado por el que te golpean.
- **Opciones:** volúmenes, calidad gráfica, temblor de cámara y borrar el progreso.
- Todo se guarda en el navegador (`localStorage`). Si el navegador no deja guardar, el juego funciona igual y lo avisa.

## Sonido
- Efectos posicionales: los oyes desde donde ocurren (el oyente va con el policía). La mayoría se sintetizan por código; los gruñidos, el rugido del jefe, la sirena, los pasos, los golpes y la música son grabaciones CC0 (ver `CREDITS.md`).
- Música de día tranquila e inquietante; de noche, ambiente tenso. Cambian con un fundido al anochecer y al amanecer.
- Los volúmenes se ajustan en la pausa y se recuerdan entre partidas.

## Jugar en el móvil / instalar
El juego es una app web instalable (PWA): a pantalla completa, en horizontal y **sin conexión** una vez cargado la primera vez.
- **iPhone / iPad (Safari):** abre la página → botón Compartir → **Añadir a pantalla de inicio**. Ábrelo desde el icono nuevo.
- **Android (Chrome):** menú ⋮ → **Instalar app** (o "Añadir a pantalla de inicio").
- En iPhone, **el interruptor de silencio (lateral) silencia el juego**; sube también el volumen del teléfono. El audio se activa con el primer toque.
- Para actualizar, basta con abrirlo con conexión: el juego se refresca solo (la primera carga tras una versión nueva puede tardar un poco).
- Publicación: `npm run build` y subir `dist/` a cualquier hosting estático. Las rutas son relativas, así que vale en la raíz (Netlify) o en una subruta (GitHub Pages, `/turno-de-noche/`).

## Desarrollo
- `npm test`: tests unitarios.
- `npm run build`: build de producción.
- `node tools/genmap.cjs`: regenera `src/data/map.json` (mapa de la comisaría).
- `python tools/gen_icons.py`: regenera los iconos de la PWA en `public/icons/` (Pillow).
- `python tools/convert_audio.py`: genera el `.mp3` de cada `.ogg` de `public/audio` (ffmpeg). Safari/iOS usa los MP3. Hay que ejecutarlo al añadir un sonido nuevo.
- Service worker (`public/sw.js`): la lista de archivos a precachear se inyecta al hacer el build (`vite.config.js`). Si cambia la lógica de caché, sube `CACHE` (`tdn-v2`…).
- Estado del proyecto: ver [PROGRESS.md](PROGRESS.md).
- Créditos de assets: ver [CREDITS.md](CREDITS.md).
