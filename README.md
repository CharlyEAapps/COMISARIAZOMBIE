# Turno de Noche

Supervivencia zombi en 3D low-poly para el navegador. Eres un policía que defiende su comisaría: de día preparas la defensa y de noche aguantas la horda.

## Arrancar
```bash
npm install
npm run dev
```
Después abre http://localhost:5173.

## Controles (estado actual: fase 1)
| Tecla | Acción |
|---|---|
| WASD / flechas | Mover |
| Ratón | Apuntar (la cámara se adelanta hacia el cursor) |
| Clic izquierdo | Disparar |
| R | Recargar |
| Shift | Correr (gasta resistencia) |
| Rueda | Zoom |
| Esc | Pausa |
| Enter | Reintentar tras morir |
| F1 | Panel de depuración (modo dios, generar zombis, ver flow field…) |

## Desarrollo
- `npm test`: tests unitarios.
- `npm run build`: build de producción.
- `node tools/genmap.cjs`: regenera `src/data/map.json` (mapa de la comisaría).
- Estado del proyecto: ver [PROGRESS.md](PROGRESS.md).
- Créditos de assets: ver [CREDITS.md](CREDITS.md).
