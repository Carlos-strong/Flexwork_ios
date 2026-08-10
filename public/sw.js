// Service worker retiré (PwaRegister n'est plus câblé dans src/app/layout.tsx depuis la
// purge de l'UI). Ce fichier ne fait plus que désinstaller toute copie déjà active dans le
// navigateur d'un utilisateur — sans ça, un vieux SW installé avant ce changement continue
// d'intercepter les requêtes indéfiniment et sert une coquille "/" périmée après chaque
// rebuild (chunks 404, hydratation cassée).
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clientsList = await self.clients.matchAll({ type: "window" });
      for (const client of clientsList) {
        client.navigate(client.url);
      }
    })()
  );
});
