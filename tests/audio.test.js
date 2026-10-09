import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import audio from '../src/data/audio.json';
import { RECIPES } from '../src/audio/Synth.js';
import { structureMaterial } from '../src/audio/AudioSystem.js';

const known = (name) => !!RECIPES[name] || !!audio.files[name] || !!audio.groups[name];

describe('Audio: datos', () => {
  it('cada sonido configurado existe como receta, archivo o grupo', () => {
    for (const name of Object.keys(audio.sounds)) expect(known(name), name).toBe(true);
  });

  it('cada miembro de un grupo existe como receta o archivo', () => {
    for (const [g, list] of Object.entries(audio.groups)) {
      for (const m of list) expect(!!RECIPES[m] || !!audio.files[m], `${g} → ${m}`).toBe(true);
    }
  });

  it('los archivos y la música existen en public/', () => {
    for (const url of [...Object.values(audio.files), ...Object.values(audio.music.files)]) {
      expect(fs.existsSync(`public/${url}`), url).toBe(true);
    }
  });

  it('las recetas tienen duración positiva', () => {
    for (const [name, [dur, fn]] of Object.entries(RECIPES)) {
      expect(dur, name).toBeGreaterThan(0);
      expect(typeof fn).toBe('function');
    }
  });

  it('el material de los golpes depende del tipo y nivel de la pieza', () => {
    expect(structureMaterial('barricada', 0)).toBe('madera');
    expect(structureMaterial('barricada', 1)).toBe('metal');
    expect(structureMaterial('barricada', 2)).toBe('hormigon');
    expect(structureMaterial('sacos', 1)).toBe('blando');
    expect(structureMaterial('puerta', 0)).toBe('metal');
  });
});
