// Service worker van RSLNT. Eén strategie voor alles: eerst het netwerk (dan zie je altijd de
// nieuwste versie en de nieuwste gegevens), en alleen als dat niet lukt de laatst bewaarde
// kopie. Zo blijft een training die je al open had bruikbaar als het bereik wegvalt; wat je
// dan opslaat, bewaart de offline-wachtrij in common.js.

const CACHE = "rslnt-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const naam of await caches.keys()) if (naam !== CACHE) await caches.delete(naam);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Inloggen en sessie nooit uit een cache: dat moet altijd de echte stand zijn.
  if (url.pathname.startsWith("/api/auth/")) return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      } catch (fout) {
        // Pagina's zijn statisch: training.html?id=… is dezelfde HTML voor elke training.
        const isPagina = request.mode === "navigate";
        const bewaard = await caches.match(request, { ignoreSearch: isPagina });
        if (bewaard) return bewaard;
        throw fout;
      }
    })(),
  );
});
