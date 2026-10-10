import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import audio from '../src/data/audio.json';
import { preferMp3, withAudioExt } from '../src/audio/AudioSystem.js';

const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0';

describe('formato de audio', () => {
  it('usa MP3 en Safari/iOS o si no hay soporte de Vorbis', () => {
    expect(preferMp3('', CHROME)).toBe(true);
    expect(preferMp3('probably', IOS)).toBe(true);
    expect(preferMp3('maybe', IOS_CHROME)).toBe(true);
    expect(preferMp3('maybe', MAC_SAFARI)).toBe(true);
  });
  it('usa OGG en Chrome, Android y Firefox', () => {
    for (const ua of [CHROME, ANDROID, FIREFOX]) expect(preferMp3('probably', ua)).toBe(false);
  });
  it('cambia solo la extensión', () => {
    expect(withAudioExt('audio/step_1.ogg', 'mp3')).toBe('audio/step_1.mp3');
    expect(withAudioExt('audio/music_day.mp3', 'ogg')).toBe('audio/music_day.ogg');
    expect(withAudioExt('audio/a.ogg.txt', 'mp3')).toBe('audio/a.ogg.txt');
  });
  it('todos los .ogg de public/audio tienen su .mp3', () => {
    const oggs = fs.readdirSync('public/audio').filter((f) => f.endsWith('.ogg'));
    expect(oggs.length).toBeGreaterThan(0);
    for (const f of oggs) {
      const mp3 = `public/audio/${f.replace(/\.ogg$/, '.mp3')}`;
      expect(fs.existsSync(mp3), mp3).toBe(true);
      expect(fs.statSync(mp3).size, mp3).toBeGreaterThan(500);
    }
  });
  it('los archivos de audio.json tienen versión MP3', () => {
    for (const url of [...Object.values(audio.files), ...Object.values(audio.music.files)]) {
      expect(fs.existsSync(`public/${withAudioExt(url, 'mp3')}`), url).toBe(true);
    }
  });
});

describe('PWA', () => {
  const manifest = JSON.parse(fs.readFileSync('public/manifest.webmanifest', 'utf8'));
  it('el manifest es instalable y usa rutas relativas', () => {
    expect(manifest.name).toBe('Turno de Noche');
    expect(manifest.short_name).toBeTruthy();
    expect(['fullscreen', 'standalone']).toContain(manifest.display);
    expect(manifest.orientation).toBe('landscape');
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.background_color).toBe('#0b0d10');
    for (const i of manifest.icons) {
      expect(i.src.startsWith('/'), i.src).toBe(false);
      expect(fs.existsSync(path.join('public', i.src)), i.src).toBe(true);
    }
    const sizes = manifest.icons.map((i) => `${i.sizes}/${i.purpose}`);
    expect(sizes).toContain('192x192/any');
    expect(sizes).toContain('512x512/any');
    expect(sizes).toContain('512x512/maskable');
  });
  it('index.html enlaza manifest e iconos y permite pantalla completa en iOS', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    for (const s of ['rel="manifest"', 'rel="apple-touch-icon"', 'apple-mobile-web-app-capable', 'mobile-web-app-capable',
      'black-translucent', 'theme-color', 'viewport-fit=cover']) expect(html, s).toContain(s);
    expect(fs.existsSync('public/icons/apple-touch-icon.png')).toBe(true);
    expect(fs.existsSync('public/icons/favicon-32.png')).toBe(true);
  });
  it('el service worker tiene caché versionada y el marcador de precaché que rellena vite.config.js', () => {
    const sw = fs.readFileSync('public/sw.js', 'utf8');
    expect(sw).toMatch(/const CACHE = 'tdn-v\d+'/);
    expect(sw).toContain('/*PRECACHE_LIST*/');
    expect(sw).toContain('/*END_PRECACHE_LIST*/');
    expect(sw).not.toMatch(/register\(['"]\//); // sin rutas absolutas
  });
  it('vite usa rutas relativas', () => {
    expect(fs.readFileSync('vite.config.js', 'utf8')).toMatch(/BASE = '\.\/'/);
  });
});
