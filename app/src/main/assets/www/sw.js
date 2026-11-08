// 별길 VEC 오프라인 저장: 주행 중 통신이 끊겨도 돌아가게 한다. 다른 페이지는 건드리지 않는다
const CACHE = 'vec-v272';
const FILES = ['vec.html', 'vec.webmanifest', 'vec.mp3', 'song2.mp3', 'song3.mp3', 'song4.mp3', 'icon-192.png', 'icon-512.png', 'songsync.js', 'vecsync.js', 'fx.js', 'fx-aurora.js', 'fx-fog.js', 'fx-fish.js', 'whale-pts.js', 'fx-whale.js', 'fx-breach.js', 'fx-meteor.js', 'constellations-sky.js', 'route-gwanghwamun-hyundai.js', 'route-coex-yangjae.js'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url), name = u.pathname.split('/').pop();
  if (u.origin !== location.origin || !FILES.includes(name)) return;
  if (name === 'vec.html' || name.endsWith('.js')) {            // 화면과 코드는 새 판을 먼저, 끊기면 저장본
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(k => k.put(name, c)); return r; }).catch(() => caches.match(name)));
  } else e.respondWith(caches.match(name).then(r => r || fetch(e.request)));
});
