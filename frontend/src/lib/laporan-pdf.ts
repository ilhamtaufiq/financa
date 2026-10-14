import type { jsPDF } from 'jspdf';
import type { ArusKasRekening, LabaRugi } from './api';
import { batasAtasSumbu, ringkasIrisan, type Irisan } from './diagram';
import { rupiahRingkas } from './format';

// Ekspor laporan ke PDF (A4) di browser. jsPDF dan jspdf-autotable dimuat saat tombol diklik, bukan saat halaman dibuka,
// karena ukurannya besar dan sebagian besar pengunjung tidak mengunduh PDF.
// Font bawaan PDF (Helvetica) tidak memuat tanda minus Unicode, jadi angka negatif memakai tanda hubung biasa.

export interface DataPdf {
  organisasi: string;
  /** Mis. "Oktober 2026". */
  periode: string;
  /** Mis. "2026-10", dipakai untuk nama berkas. */
  kunciPeriode: string;
  dicetak: string;
  labaRugi: LabaRugi;
  jumlahTransaksi: number;
  tren: { labelPanjang: string; masuk: number; keluar: number }[];
  arusKas: ArusKasRekening[];
}

const LABEL_JENIS: Record<ArusKasRekening['jenis'], string> = { kas: 'Kas', bank: 'Bank', lainnya: 'Lainnya' };

function uang(nilai: number | string): string {
  const n = Number(nilai);
  const angka = Math.abs(n).toLocaleString('id-ID', { maximumFractionDigits: 2 });
  return `${n < 0 ? '-' : ''}Rp ${angka}`;
}

function persen(bagian: string, total: string): string {
  const t = Number(total);
  return t > 0 ? `${Math.round((Number(bagian) / t) * 100)}%` : '0%';
}

type RGB = [number, number, number];

// Warna sama dengan grafik di layar (lihat DiagramBatang dan DiagramDonat).
const WARNA_MASUK = '#8fd45f';
const WARNA_KELUAR = '#f4a6b8';
const WARNA_IRISAN = ['#a5dd7f', '#e0a7ee', '#a9c6f2', '#e8d36f', '#f4b6a6'];
const WARNA_LAINNYA = '#cfc7c5';
const MAKS_IRISAN = 5;

function hexKeRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Batang berpasangan (masuk dan keluar) per periode, digambar sebagai vektor. */
function gambarBatang(doc: jsPDF, x: number, y: number, lebar: number, tinggi: number, data: { label: string; masuk: number; keluar: number }[]) {
  const kiri = 52;
  const bawah = 18;
  const atasPad = 6;
  const lebarPlot = lebar - kiri;
  const tinggiPlot = tinggi - bawah - atasPad;
  const maks = batasAtasSumbu(Math.max(0, ...data.map((t) => Math.max(t.masuk, t.keluar))));

  doc.setLineWidth(0.5);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  for (let i = 0; i <= 4; i++) {
    const gy = y + atasPad + tinggiPlot - (tinggiPlot * i) / 4;
    doc.setDrawColor(232, 230, 229);
    doc.line(x + kiri, gy, x + lebar, gy);
    doc.setTextColor(107, 114, 128);
    doc.text(rupiahRingkas((maks * i) / 4), x + kiri - 6, gy + 2.5, { align: 'right' });
  }

  const slot = lebarPlot / data.length;
  const lebarBatang = Math.min(16, slot * 0.28);
  const batang = (cx: number, nilai: number, warna: string) => {
    const t = Math.max(nilai > 0 ? 1 : 0, (nilai / maks) * tinggiPlot);
    if (t <= 0) return;
    doc.setFillColor(...hexKeRgb(warna));
    const by = y + atasPad + tinggiPlot - t;
    if (t > 4) doc.roundedRect(cx, by, lebarBatang, t, 2, 2, 'F');
    else doc.rect(cx, by, lebarBatang, t, 'F');
  };
  data.forEach((t, i) => {
    const pusat = x + kiri + slot * i + slot / 2;
    batang(pusat - lebarBatang - 1.5, t.masuk, WARNA_MASUK);
    batang(pusat + 1.5, t.keluar, WARNA_KELUAR);
    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);
    doc.text(t.label, pusat, y + tinggi - 4, { align: 'center' });
  });
}

/** Satu irisan donat sebagai poligon: busur luar dari a0 ke a1, lalu busur dalam kembali dari a1 ke a0. */
function gambarIrisanDonat(doc: jsPDF, cx: number, cy: number, rLuar: number, rDalam: number, a0: number, a1: number) {
  const langkah = Math.max(2, Math.ceil((a1 - a0) / (Math.PI / 45)));
  const titik: [number, number][] = [];
  for (let i = 0; i <= langkah; i++) {
    const a = a0 + ((a1 - a0) * i) / langkah;
    titik.push([cx + rLuar * Math.cos(a), cy + rLuar * Math.sin(a)]);
  }
  for (let i = langkah; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / langkah;
    titik.push([cx + rDalam * Math.cos(a), cy + rDalam * Math.sin(a)]);
  }
  const [x0, y0] = titik[0];
  const relatif = titik.slice(1).map(([px, py], i) => [px - titik[i][0], py - titik[i][1]] as [number, number]);
  doc.lines(relatif, x0, y0, [1, 1], 'F', true);
}

/** Donat komposisi dengan teks di tengah, lalu legenda (warna, nama, persen) di bawahnya. Mengembalikan tinggi yang terpakai. */
function gambarDonatDenganLegenda(
  doc: jsPDF,
  x: number,
  y: number,
  lebar: number,
  judul: string,
  irisanMentah: Irisan[],
  pusatLabel: string,
  pusatNilai: string,
) {
  const irisan = ringkasIrisan(irisanMentah, MAKS_IRISAN);
  const total = irisan.reduce((jml, i) => jml + i.nilai, 0);
  const radius = 52;
  const cx = x + lebar / 2;
  const cy = y + 18 + radius;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(26, 26, 26);
  doc.text(judul, cx, y + 6, { align: 'center' });

  if (total <= 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(107, 114, 128);
    doc.text('Belum ada data', cx, cy, { align: 'center' });
    return;
  }

  const warnaUntuk = (i: number, label: string) =>
    label === 'Lainnya' && irisan.length === MAKS_IRISAN ? WARNA_LAINNYA : WARNA_IRISAN[i % WARNA_IRISAN.length];

  let sudut = -Math.PI / 2;
  irisan.forEach((s, i) => {
    const sapuan = (s.nilai / total) * Math.PI * 2;
    doc.setFillColor(...hexKeRgb(warnaUntuk(i, s.label)));
    if (sapuan >= Math.PI * 2 - 1e-6) {
      // Satu irisan penuh: cincin dari dua lingkaran.
      doc.circle(cx, cy, radius, 'F');
      doc.setFillColor(255, 255, 255);
      doc.circle(cx, cy, radius * 0.62, 'F');
    } else {
      gambarIrisanDonat(doc, cx, cy, radius, radius * 0.62, sudut, sudut + sapuan);
    }
    sudut += sapuan;
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(107, 114, 128);
  doc.text(pusatLabel, cx, cy - 2, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(26, 26, 26);
  doc.text(pusatNilai, cx, cy + 9, { align: 'center' });

  let ly = cy + radius + 22;
  irisan.forEach((s, i) => {
    doc.setFillColor(...hexKeRgb(warnaUntuk(i, s.label)));
    doc.circle(x + 6, ly - 3, 3.2, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(26, 26, 26);
    const nama = s.label.length > 24 ? `${s.label.slice(0, 23)}...` : s.label;
    doc.text(nama, x + 16, ly);
    doc.setFont('helvetica', 'bold');
    doc.text(`${Math.round((s.nilai / total) * 100)}%`, x + lebar, ly, { align: 'right' });
    ly += 14;
  });
}

export async function unduhPdfLaporan(d: DataPdf): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const lebar = doc.internal.pageSize.getWidth();
  const margin = 40;
  const isi = lebar - margin * 2;
  let y = 54;

  const ungu: [number, number, number] = [138, 32, 165];
  const gelap: [number, number, number] = [26, 26, 26];
  const redup: [number, number, number] = [107, 114, 128];

  // Kepala dokumen.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...ungu);
  doc.text('Laporan keuangan', margin, y);
  y += 22;
  // Organisasi diberi label dan nama tebal, supaya jelas laporan ini milik siapa.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...redup);
  doc.text('Organisasi', margin, y);
  y += 15;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...gelap);
  doc.text(d.organisasi, margin, y);
  y += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...redup);
  doc.text(`Periode ${d.periode}  |  Dicetak ${d.dicetak}  |  ${d.jumlahTransaksi} transaksi`, margin, y);
  y += 22;

  // Tiga kotak ringkasan.
  const kotak = [
    { judul: 'Pendapatan', nilai: uang(d.labaRugi.total_pendapatan), latar: [223, 247, 230] as [number, number, number], teks: [31, 107, 58] as [number, number, number] },
    { judul: 'Beban', nilai: uang(d.labaRugi.total_beban), latar: [255, 230, 238] as [number, number, number], teks: [154, 44, 80] as [number, number, number] },
    {
      judul: 'Laba bersih',
      nilai: uang(d.labaRugi.laba_bersih),
      latar: [235, 230, 255] as [number, number, number],
      teks: Number(d.labaRugi.laba_bersih) < 0 ? ([186, 26, 26] as [number, number, number]) : ([75, 58, 168] as [number, number, number]),
    },
  ];
  const lebarKotak = (isi - 16) / 3;
  kotak.forEach((k, i) => {
    const x = margin + i * (lebarKotak + 8);
    doc.setFillColor(...k.latar);
    doc.roundedRect(x, y, lebarKotak, 56, 12, 12, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...k.teks);
    doc.text(k.judul, x + 12, y + 20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(k.nilai, x + 12, y + 40);
  });
  y += 56 + 24;

  const gayaDasar = {
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 6, textColor: gelap, lineColor: [236, 232, 231] as [number, number, number], lineWidth: 0.5 },
    headStyles: { fillColor: ungu, textColor: [255, 255, 255] as [number, number, number], fontStyle: 'bold' as const },
    alternateRowStyles: { fillColor: [252, 249, 248] as [number, number, number] },
    margin: { left: margin, right: margin },
  };

  function bagian(judul: string, tabel: Parameters<typeof autoTable>[1]) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...gelap);
    // Judul dan tabelnya tidak boleh terpisah di pergantian halaman.
    if (y > doc.internal.pageSize.getHeight() - 140) {
      doc.addPage();
      y = 54;
    }
    doc.text(judul, margin, y);
    // Rata kolom pada isi tabel juga berlaku untuk judul dan baris total, supaya angka dan judulnya sejajar.
    const rataKolom = (tabel.columnStyles ?? {}) as Record<number, { halign?: 'left' | 'center' | 'right' }>;
    autoTable(doc, {
      ...gayaDasar,
      ...tabel,
      startY: y + 8,
      didParseCell: (h) => {
        const rata = rataKolom[h.column.index]?.halign;
        if (rata && h.section !== 'body') h.cell.styles.halign = rata;
      },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 26;
  }

  // Bagian grafik: judul, lalu gambar vektor. Berpindah halaman bila sisa ruang tidak cukup.
  function grafik(judul: string, tinggi: number, gambar: (x: number, yy: number) => void) {
    if (y + 14 + tinggi > doc.internal.pageSize.getHeight() - 44) {
      doc.addPage();
      y = 54;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...gelap);
    doc.text(judul, margin, y);
    gambar(margin, y + 14);
    y += 14 + tinggi + 24;
  }

  grafik('Tren enam bulan', 176, (x, yy) => {
    gambarBatang(
      doc,
      x,
      yy,
      isi,
      152,
      d.tren.map((t) => ({ label: t.labelPanjang.split(' ')[0].slice(0, 3), masuk: t.masuk, keluar: t.keluar })),
    );
    // Legenda di bawah grafik.
    const ly = yy + 168;
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(107, 114, 128);
    doc.setFillColor(...hexKeRgb(WARNA_MASUK));
    doc.circle(x + 54, ly - 3, 3.2, 'F');
    doc.text('Pemasukan', x + 62, ly);
    doc.setFillColor(...hexKeRgb(WARNA_KELUAR));
    doc.circle(x + 130, ly - 3, 3.2, 'F');
    doc.text('Pengeluaran', x + 138, ly);
  });

  bagian('Rincian per bulan', {
    head: [['Bulan', 'Pemasukan', 'Pengeluaran', 'Selisih']],
    body: d.tren.map((t) => [t.labelPanjang, uang(t.masuk), uang(t.keluar), uang(t.masuk - t.keluar)]),
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right', fontStyle: 'bold' } },
  });

  // Dua donat berdampingan: komposisi pendapatan dan komposisi beban, masing-masing dengan legenda persen.
  grafik('Komposisi kategori', 200, (x, yy) => {
    const kolom = isi / 2 - 10;
    gambarDonatDenganLegenda(
      doc, x, yy, kolom, 'Pendapatan',
      d.labaRugi.pendapatan.map((b) => ({ label: b.kategori, nilai: Number(b.total) })),
      'Total', uang(d.labaRugi.total_pendapatan),
    );
    gambarDonatDenganLegenda(
      doc, x + isi / 2 + 10, yy, kolom, 'Beban',
      d.labaRugi.beban.map((b) => ({ label: b.kategori, nilai: Number(b.total) })),
      'Total', uang(d.labaRugi.total_beban),
    );
  });

  const barisKategori = (baris: LabaRugi['pendapatan'], total: string) =>
    baris.length > 0
      ? baris.map((b) => [b.kategori, String(b.jumlah_transaksi), uang(b.total), persen(b.total, total)])
      : [['Belum ada data', '', '', '']];

  bagian('Pendapatan per kategori', {
    head: [['Kategori', 'Transaksi', 'Jumlah', 'Porsi']],
    body: barisKategori(d.labaRugi.pendapatan, d.labaRugi.total_pendapatan),
    foot: [['Total', '', uang(d.labaRugi.total_pendapatan), '100%']],
    footStyles: { fillColor: [246, 243, 242], textColor: gelap, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
  });

  bagian('Beban per kategori', {
    head: [['Kategori', 'Transaksi', 'Jumlah', 'Porsi']],
    body: barisKategori(d.labaRugi.beban, d.labaRugi.total_beban),
    foot: [['Total', '', uang(d.labaRugi.total_beban), '100%']],
    footStyles: { fillColor: [246, 243, 242], textColor: gelap, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
  });

  if (d.arusKas.length > 0) {
    bagian('Saldo per rekening', {
      head: [['Rekening', 'Jenis', 'Saldo awal', 'Masuk', 'Keluar', 'Saldo akhir']],
      body: d.arusKas.map((a) => [a.nama, LABEL_JENIS[a.jenis], uang(a.saldo_awal_periode), uang(a.masuk), uang(a.keluar), uang(a.saldo_akhir)]),
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right', fontStyle: 'bold' } },
    });
  }

  // Nomor halaman di kaki setiap halaman.
  const jumlahHalaman = doc.getNumberOfPages();
  for (let i = 1; i <= jumlahHalaman; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...redup);
    doc.text(`Financa  -  halaman ${i} dari ${jumlahHalaman}`, margin, doc.internal.pageSize.getHeight() - 24);
  }

  doc.save(`Laporan-Financa-${d.kunciPeriode}.pdf`);
}
