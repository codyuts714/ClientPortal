const CACHE = "uts-client-os-v8";
const CORE = [
  "./", "./index.html", "./manifest.json", "./favicon.ico",
  "./icons/apple-touch-icon.png", "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/maskable-192.png", "./icons/maskable-512.png",
  "./icons/favicon-32.png", "./icons/favicon-16.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // fonts and other cross-origin assets: cache-first so the app opens offline looking right
  if (url.origin !== location.origin) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return r;
      }).catch(() => hit))
    );
    return;
  }

  // app files: network-first so deploys land immediately, cache as offline fallback
  e.respondWith(
    fetch(req).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return r;
    }).catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
  );
});
