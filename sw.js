const CACHE = 'daily-assistant-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
];
self.addEventListener('install', (e)=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener('activate', (e)=>{
  e.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e)=>{
  const url = new URL(e.request.url);
  if (e.request.method!=='GET') return;
  e.respondWith((async ()=>{
    const cached = await caches.match(e.request);
    if (cached) return cached;
    try {
      const res = await fetch(e.request);
      const cache = await caches.open(CACHE);
      cache.put(e.request, res.clone());
      return res;
    } catch (err){
      // offline fallback
      if (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')){
        return caches.match('./index.html');
      }
      return new Response('Offline', { status: 503, statusText:'Offline' });
    }
  })());
});
