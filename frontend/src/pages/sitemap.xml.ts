import type { APIRoute } from 'astro';

// Sitemap hanya memuat halaman publik yang memang ingin muncul di pencarian.
// Halaman auth dan /app/* sengaja tidak ada di sini (noindex).
// Tanpa PUBLIC_SITE_URL, URL absolut tidak bisa dibuat, jadi sitemap dibiarkan kosong.
const HALAMAN_PUBLIK = ['/'];

export const GET: APIRoute = ({ site }) => {
  const isi = site
    ? HALAMAN_PUBLIK.map((path) => `  <url><loc>${new URL(path, site).href}</loc></url>`).join('\n')
    : '';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${isi}${isi ? '\n' : ''}</urlset>\n`;

  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
