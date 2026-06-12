// Fix: Updated the ASSETS_TO_CACHE list to include App.tsx and remove the unused Calc.tsx.
const CACHE_NAME = 'icalc-26-v4';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './index.tsx',
'./App.tsx',
  './types.ts'
];

// Check if running in development mode
const isDev = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  if (isDev) return; // Skip caching in dev
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('activate', (event) => {
  if (isDev) return; // Skip cache cleanup in dev
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // In dev mode, always fetch from network
  if (isDev) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response;
      }
      return fetch(event.request).then((networkResponse) => {
        const isTrustedSource = 
          event.request.url.startsWith('https://esm.sh/') || 
          event.request.url.startsWith('https://images.unsplash.com/') ||
          event.request.url.startsWith('https://cdn.tailwindcss.com');

        if (isTrustedSource) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      });
    }).catch(() => {
      // Offline support can be enhanced with a fallback page here
    })
  );
});