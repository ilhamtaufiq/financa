/* Service worker Financa: app-shell offline-first.
 * Respons API TIDAK di-cache. Data offline ada di IndexedDB (Dexie), dan cache HTTP
 * akan tertinggal antar sesi di perangkat yang sama. */
const VERSI = 'financa-v5';
const APP_SHELL = ['/', '/app', '/app/transaksi', '/app/transaksi/baru', '/app/laporan', '/app/pengaturan', '/daftar', '/masuk', '/offline', '/manifest.webmanifest', '/ikon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSI).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()).catch(() => {}),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSI).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // API dilewati: tidak di-cache dan tidak dicegat.
  if (url.pathname.startsWith('/api/')) return;

  // Navigasi (halaman HTML): jaringan dulu. Cache-first di sini membuat HTML lama tetap tampil
  // setelah deploy, lalu merujuk berkas JS yang sudah tidak ada, dan halaman macet.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          if (r.ok) caches.open(VERSI).then((c) => c.put(e.request, r.clone())).catch(() => {});
          return r;
        })
        .catch(() => caches.match(e.request).then((hit) => hit || caches.match('/offline'))),
    );
    return;
  }

  const simpan = (r) => {
    if (url.origin === location.origin && r.ok) {
      const salin = r.clone();
      caches.open(VERSI).then((c) => c.put(e.request, salin)).catch(() => {});
    }
    return r;
  };

  // Berkas hasil build di /_astro/ memuat hash di namanya, jadi isinya tidak pernah berubah: cache-first.
  if (url.pathname.startsWith('/_astro/')) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then(simpan).catch(() => Response.error())),
    );
    return;
  }

  // Aset lain (avatar, ikon, manifest) namanya tetap tetapi isinya bisa berubah: tampilkan cache,
  // lalu perbarui di belakang layar supaya kunjungan berikutnya sudah versi baru.
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const jaringan = fetch(e.request).then(simpan).catch(() => hit || Response.error());
      return hit || jaringan;
    }),
  );
});
