import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

// Astro menyisipkan runtime hidrasi sebagai <script> inline di setiap halaman.
// Dengan CSP script-src 'self' script itu diblokir, jadi kita tambahkan hash-nya
// per halaman setelah build. Placeholder ada di layout App.astro.
const PLACEHOLDER = '__CSP_SCRIPT_HASHES__';

async function berkasHtml(dir) {
  const hasil = [];
  for (const entri of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entri.name);
    if (entri.isDirectory()) hasil.push(...(await berkasHtml(path)));
    else if (entri.name.endsWith('.html')) hasil.push(path);
  }
  return hasil;
}

// Hanya <script> tanpa atribut src (inline).
const POLA_INLINE = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;

function hashInline(html) {
  return [...html.matchAll(POLA_INLINE)].map(
    (m) => `'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`,
  );
}

const cspHash = {
  name: 'csp-hash',
  hooks: {
    'astro:build:done': async ({ dir }) => {
      const root = fileURLToPath(dir);
      for (const file of await berkasHtml(root)) {
        const html = await readFile(file, 'utf8');
        if (!html.includes(PLACEHOLDER)) continue;
        const hashes = hashInline(html);
        await writeFile(file, html.replace(PLACEHOLDER, hashes.join(' ')), 'utf8');
      }
    },
  },
};

export default defineConfig({
  integrations: [react(), tailwind(), cspHash],
  // Alamat produksi, mis. https://financa.contoh.com. Dipakai untuk canonical, Open Graph, dan sitemap.
  // Kosong = tag yang butuh URL absolut dilewati, dan sitemap kosong.
  site: process.env.PUBLIC_SITE_URL || undefined,
  output: 'static',
  server: { port: 4322 },
  devToolbar: { enabled: false },
  // URL lama tetap berfungsi. Bookmark dan tautan di luar aplikasi tidak rusak.
  redirects: {
    '/transaksi': '/app/transaksi',
    '/transaksi/baru': '/app/transaksi/baru',
    '/laporan': '/app/laporan',
    '/pengaturan': '/app/pengaturan',
  },
});
