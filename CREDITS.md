# Créditos

Todos los assets de terceros son **CC0** (dominio público). Aunque no es obligatorio, se acredita a sus autores. Licencia comprobada en la página de cada asset el 2026-10-09. Los originales se han recortado y convertido a OGG (mono, 22 kHz para efectos) con ffmpeg. Cada OGG tiene además una copia MP3 (`tools/convert_audio.py`) para Safari/iOS. Los iconos de la app se generan por código (`tools/gen_icons.py`).

| Asset | Autor | URL | Licencia | Ruta local |
|---|---|---|---|---|
| Monster Snarls (5 archivos, cortados en clips) | Darsycho | https://opengameart.org/content/monster-snarls | CC0 | `public/audio/zombie_01..30.ogg` |
| Zombie moans (cortado en clips) | Darsycho | https://opengameart.org/content/zombie-moans | CC0 | `public/audio/zombie_31..33.ogg` |
| 5 Hit Sounds + Dying (die1) | TinyWorlds | https://opengameart.org/content/5-hit-sounds-dying | CC0 | `public/audio/death_1.ogg` |
| CC0 Deep Monster Roar (recortado a 3,5 s) | trazzz123 | https://opengameart.org/content/cc0-deep-monster-roar | CC0 | `public/audio/boss_roar.ogg` |
| Sirens and Alarm Noise (siren, recortada a 8 s) | aquinn | https://opengameart.org/content/sirens-and-alarm-noise | CC0 | `public/audio/siren.ogg` |
| Synthwave House Loop — música de día | Fupi | https://opengameart.org/content/synthwave-house-loop | CC0 | `public/audio/music_day.ogg` (+ .mp3) |
| Zombies' March (ZombiesAreComing) — música de noche | yd | https://opengameart.org/node/6802 | CC0 | `public/audio/music_night.ogg` |
| Boss Battle #9 [Metal] (loop) — música del jefe | nene | https://opengameart.org/content/boss-battle-9-metal | CC0 | `public/audio/music_boss.ogg` (+ .mp3) |
| Impact Sounds (pasos de hormigón; golpes de madera, metal, blandos, puñetazo, minería y chapa) | Kenney | https://kenney.nl/assets/impact-sounds | CC0 | `public/audio/step_*, wood_*, metal_*, soft_*, punch_*, concrete_*, plate_*` |

El resto de efectos (disparos, recargas, explosiones, trampas, interfaz, radio…) se sintetizan por código en `src/audio/Synth.js`. El arte del juego es todo procedural.

## Software
- [three.js](https://threejs.org): MIT
- [Vite](https://vite.dev): MIT
- [Vitest](https://vitest.dev): MIT
- [lil-gui](https://lil-gui.georgealways.com): MIT
- [ffmpeg](https://ffmpeg.org) (solo para preparar los audios, no se distribuye): LGPL/GPL
