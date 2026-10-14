/** @type {import('tailwindcss').Config} */
// Warna dari landing-page/design-system/cianjur-space/MASTER.md (brand Cendera).
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Warna memakai variabel CSS (channel RGB) supaya tema terang bisa diganti per halaman.
        // Nilainya ada di src/styles/global.css.
        cendera: {
          DEFAULT: 'rgb(var(--cendera) / <alpha-value>)',
          600: 'rgb(var(--cendera-600) / <alpha-value>)',
          700: 'rgb(var(--cendera-700) / <alpha-value>)',
        },
        latar: 'rgb(var(--latar) / <alpha-value>)',
        permukaan: 'rgb(var(--permukaan) / <alpha-value>)',
        inset: 'rgb(var(--inset) / <alpha-value>)',
        garis: 'rgb(var(--garis) / <alpha-value>)',
        teks: 'rgb(var(--teks) / <alpha-value>)',
        redup: 'rgb(var(--redup) / <alpha-value>)',
        bahaya: 'rgb(var(--bahaya) / <alpha-value>)',
      },
      fontFamily: {
        // DM Sans untuk semua teks (sesuai spesifikasi). Judul memakai berat 700.
        display: ['"DM Sans Variable"', 'system-ui', 'sans-serif'],
        sans: ['"DM Sans Variable"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
