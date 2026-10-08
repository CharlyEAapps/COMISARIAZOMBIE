# Turno de Noche

Supervivencia zombi en 3D low-poly para el navegador. Eres un policía que defiende su comisaría: de día preparas la defensa y de noche aguantas la horda.

## Arrancar
```bash
npm install
npm run dev
```
Después abre http://localhost:5173.

## Cómo se juega
De día preparas la comisaría; al anochecer suena la sirena y llega la horda. La noche termina cuando se acaba el tiempo **y** no queda ningún zombi. Cada noche hay más zombis, más rápidos y más resistentes. Al amanecer cobras un bonus (más si no te han tocado o si has resuelto el caso de la pizarra).

## Controles
| Tecla | Acción |
|---|---|
| WASD / flechas | Mover |
| Ratón | Apuntar (la cámara se adelanta hacia el cursor) |
| Clic izquierdo | Disparar |
| R | Recargar |
| Shift | Correr (gasta resistencia) |
| E (mantener) | Interactuar con lo que tengas delante |
| Q | Usar botiquín |
| N | Empezar la noche ya (de día) |
| Rueda | Zoom |
| Esc | Pausa |
| Enter | Reintentar tras morir |
| F1 | Panel de depuración (modo dios, saltar a la noche, generar zombis, ver flow field…) |

## Interacciones de la comisaría
| Objeto | Efecto |
|---|---|
| ☕ Cafetera | Resistencia a tope y recuperación ×2 durante 60 s (una vez por día) |
| 🍫 Máquina de vending | +15 de vida por 25 puntos |
| 💧 Fuente de agua | +8 de vida |
| 🗄️ Taquillas | Botiquín, dinero… o calcetines sucios (una vez por día) |
| 📁 Archivadores | Puntos por expedientes o información sobre la horda (una vez por día) |
| 🩹 Botiquín de pared | +1 botiquín (una vez por día) |
| 🛏️ Camas de la enfermería | +30 de vida y saltar hasta el anochecer |
| 📞 Teléfono | Llamadas variopintas; a veces, ayuda |
| 📻 Radio | Previsión de la horda: cuántos y por dónde |
| 📹 Cámaras | Cuántos zombis hay y por dónde vienen |
| ⚡ Generador (patio) | Da corriente hasta el amanecer |
| 💡 Cuadro eléctrico | Enciende o apaga las luces de la comisaría (necesita el generador) |
| 📋 Pizarra de casos | Objetivo para la noche con recompensa |
| 🚓 Coches patrulla | La sirena atrae a los zombis cercanos durante 10 s |
| 🚨 Alarma | Luces de emergencia y zombis más lentos durante 20 s (una vez por noche) |

## Desarrollo
- `npm test`: tests unitarios.
- `npm run build`: build de producción.
- `node tools/genmap.cjs`: regenera `src/data/map.json` (mapa de la comisaría).
- Estado del proyecto: ver [PROGRESS.md](PROGRESS.md).
- Créditos de assets: ver [CREDITS.md](CREDITS.md).
