// Service worker: permite usar la app sin conexión una vez cargada.
const VERSION = "v29";
const PROPIOS = ["./", "index.html", "css/estilo.css", "css/piezas.css", "js/app.js", "js/tablero.js", "js/motor.js", "js/elo.js", "js/ranking.js", "js/config.js",
  "datos/posiciones.json", "datos/casillas.json",
  "vendor/chessground.js", "vendor/chess.js", "vendor/stockfish.js", "vendor/chessground.base.css", "vendor/chessground.brown.css", "vendor/chessground.cburnett.css", "vendor/fuentes/fuentes.css", "vendor/fuentes/DMSerifDisplay-latin.woff2", "vendor/fuentes/Manrope-latin.woff2", "icono.svg", "manifest.webmanifest",
  "iconos/icono-192.png", "iconos/icono-512.png", "iconos/icono-maskable-512.png", "iconos/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PROPIOS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const externo = url.origin !== location.origin;
  // Librerías de CDN (versionadas): primero caché. Archivos propios: primero red, caché si no hay conexión.
  e.respondWith(
    externo
      ? caches.match(e.request).then((r) => r || fetch(e.request).then((resp) => guardar(e.request, resp)))
      : fetch(e.request).then((resp) => guardar(e.request, resp)).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
function guardar(req, resp) {
  if (resp.ok) { const copia = resp.clone(); caches.open(VERSION).then((c) => c.put(req, copia)); }
  return resp;
}
