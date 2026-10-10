/* Service worker de Turno de Noche (sin dependencias).
 * - install: precachea la aplicación (index, JS/CSS con hash, iconos, manifest) y, sin bloquear la
 *   instalación, el audio del formato que usará este navegador. La lista la inyecta vite.config.js
 *   al hacer el build (marcador PRECACHE_LIST); en dev este archivo no se registra.
 * - fetch (solo GET del mismo origen):
 *     navegación (index.html)  → network-first con caída a la caché (así una versión nueva no se queda pegada);
 *     /assets/* (nombre con hash) → cache-first (inmutables);
 *     audio, iconos, manifest   → stale-while-revalidate.
 * - Todas las rutas son relativas al scope del SW, así que vale en la raíz o en una subruta.
 * - Subir CACHE (tdn-v2…) fuerza a limpiar las cachés antiguas en activate.
 */
const CACHE = 'tdn-v5';
const PRECACHE = /*PRECACHE_LIST*/{ core: ['./', './index.html', './manifest.webmanifest'], audio: [] }/*END_PRECACHE_LIST*/;
const NAV_TIMEOUT_MS = 4000;

const SCOPE = self.registration.scope;
const abs = (p) => new URL(p, SCOPE).href;

// Mismo criterio que AudioSystem.preferMp3 (Safari/iOS usan MP3; el resto, OGG).
const UA = (self.navigator && self.navigator.userAgent) || '';
const USE_MP3 = (/safari/i.test(UA) && !/chrome|chromium|crios|fxios|edg|android/i.test(UA)) || /iphone|ipad|ipod/i.test(UA);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE.core.map((p) => new Request(abs(p), { cache: 'reload' })));
    // El audio es opcional: si falla algo, se rellena después en tiempo de ejecución.
    const ext = USE_MP3 ? '.mp3' : '.ogg';
    const audio = PRECACHE.audio.filter((p) => p.endsWith(ext));
    await Promise.allSettled(audio.map((p) => cache.add(abs(p))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const cacheable = (res) => res && res.status === 200 && (res.type === 'basic' || res.type === 'default');

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), NAV_TIMEOUT_MS)),
    ]);
    if (cacheable(res)) cache.put(request, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const hit = (await cache.match(request, { ignoreSearch: true }))
      || (await cache.match(abs('./index.html')))
      || (await cache.match(abs('./')));
    if (hit) return hit;
    throw e;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (cacheable(res)) cache.put(request, res.clone()).catch(() => {});
  return res;
}

async function staleWhileRevalidate(event) {
  const { request } = event;
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  const refresh = fetch(request).then((res) => {
    if (cacheable(res)) cache.put(request, res.clone()).catch(() => {});
    return res;
  });
  if (hit) {
    event.waitUntil(refresh.catch(() => {}));
    return hit;
  }
  return refresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') event.respondWith(networkFirst(request));
  else if (url.pathname.includes('/assets/')) event.respondWith(cacheFirst(request));
  else event.respondWith(staleWhileRevalidate(event));
});
