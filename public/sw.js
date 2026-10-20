const CACHE_NAME = "novatech-erp-v2";

self.addEventListener("install", () => {
  self.skipWaiting();
});

// La activare se șterg TOATE cache-urile vechi (versiunea veche putea reține și răspunsuri cu date din baza de date).
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Strategie: network-first, cu fallback pe cache — DOAR pentru fișierele aplicației (același domeniu).
// Cererile către baza de date (Supabase) NU se păstrează niciodată în cache: datele companiei nu rămân pe dispozitiv.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copie = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copie));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
