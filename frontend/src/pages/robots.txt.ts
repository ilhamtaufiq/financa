import type { APIRoute } from 'astro';

// robots.txt dibuat saat build supaya baris Sitemap memakai alamat produksi (PUBLIC_SITE_URL).
//
// Aturan: /masuk, /daftar, /reset, dan /offline sengaja TIDAK diblokir. Halaman itu diberi
// <meta name="robots" content="noindex">, dan crawler hanya bisa membaca noindex jika halamannya boleh dibuka.
// Hanya /app/ yang diblokir, karena tidak pernah ditautkan dari halaman publik dan isinya sepenuhnya milik pengguna.
export const GET: APIRoute = ({ site }) => {
  const baris = ['User-agent: *', 'Allow: /', 'Disallow: /app/'];
  if (site) baris.push('', `Sitemap: ${new URL('/sitemap.xml', site).href}`);

  return new Response(baris.join('\n') + '\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
