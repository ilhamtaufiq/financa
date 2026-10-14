import { useEffect, useState } from 'react';
import { api, ambilSesi, type Rekening, type RingkasanBulanan, type Transaksi } from '../../lib/api';
import { ambilReferensi, EVENT_SINKRON, hitungTertunda, labelTipe, segarkanReferensi } from '../../lib/sinkron';
import { rentangBulan, rupiah, tanggalLokal } from '../../lib/format';
import { AvatarPengguna } from '../ui/AvatarPengguna';
import { Card } from '../ui/Card';
import { DeltaBadge } from '../ui/DeltaBadge';
import { Pill } from '../ui/Pill';
import { Uang } from '../ui/Uang';

// Beranda mengikuti layar "Gamified Savings" pada contoh: kartu hero dengan bilah progres, kartu misi,
// lencana sebagai kartu putih, dan kartu bulanan besar. Semua angka berasal dari catatan nyata.

const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

interface BarisSaldo {
  rekening: Rekening;
  saldo: string | null;
}

const UNGU = 'text-[#8a20a5]';

/** Salam menurut jam setempat. */
function salamWaktu(jam: number): string {
  if (jam < 11) return 'Selamat pagi';
  if (jam < 15) return 'Selamat siang';
  if (jam < 18) return 'Selamat sore';
  return 'Selamat malam';
}

/** Kata pertama dari nama, dengan huruf pertama kapital. */
function namaDepan(nama: string): string {
  const kata = nama.trim().split(/\s+/)[0] ?? '';
  return kata ? kata.charAt(0).toUpperCase() + kata.slice(1) : '';
}

const TOMBOL_IKON = 'grid size-11 shrink-0 place-items-center rounded-full bg-inset text-teks transition hover:bg-garis active:scale-95';

export default function Beranda() {
  const now = new Date();
  const [baris, setBaris] = useState<BarisSaldo[]>([]);
  const [ringkasan, setRingkasan] = useState<RingkasanBulanan | null>(null);
  const [terbaru, setTerbaru] = useState<Transaksi[]>([]);
  const [tertunda, setTertunda] = useState(0);
  const [online, setOnline] = useState(true);
  const [pesan, setPesan] = useState<string | null>(null);
  const [sesi, setSesi] = useState(true);
  const [nama, setNama] = useState('');
  // Dasar lencana dan bilah progres: jumlah transaksi bulan ini dan jumlah hari berbeda yang punya catatan.
  const [catatan, setCatatan] = useState({ jumlah: 0, hari: 0 });

  async function muat() {
    const adaSesi = ambilSesi() !== null;
    const daring = navigator.onLine;
    setOnline(daring);
    setSesi(adaSesi);
    // Nama depan untuk salam. Sesi lama belum punya nama, jadi pakai bagian email sebelum "@".
    const s = ambilSesi();
    setNama(namaDepan(s?.nama || s?.email.split('@')[0] || ''));
    setTertunda(await hitungTertunda());

    if (daring) await segarkanReferensi();
    const { rekening } = await ambilReferensi();
    const aktif = rekening.filter((r) => !r.diarsipkan_at);

    // Saldo dan statistik dihitung server. Offline, bagian ini kosong.
    const hasil = await Promise.all(
      aktif.map(async (r): Promise<BarisSaldo> => {
        if (!daring || !adaSesi) return { rekening: r, saldo: null };
        try {
          const d = await api.detailRekening(r.id);
          return { rekening: r, saldo: d.saldo };
        } catch {
          return { rekening: r, saldo: null };
        }
      }),
    );
    setBaris(hasil);

    if (daring && adaSesi) {
      try {
        const bulan = now.getMonth() + 1;
        const tahun = now.getFullYear();
        const { dari, sampai } = rentangBulan(tahun, bulan);
        const [r, daftar] = await Promise.all([api.ringkasanBulanan(tahun, bulan), api.daftarTransaksi(dari, sampai)]);
        setRingkasan(r);
        setCatatan({ jumlah: daftar.length, hari: new Set(daftar.map((t) => t.tanggal)).size });
        setTerbaru(
          [...daftar]
            .sort((a, b) => b.tanggal.localeCompare(a.tanggal) || b.id - a.id)
            .slice(0, 5),
        );
      } catch (err) {
        setPesan(err instanceof Error ? `Statistik belum bisa dimuat: ${err.message}` : 'Statistik belum bisa dimuat.');
      }
    } else {
      setRingkasan(null);
      setTerbaru([]);
    }
  }

  useEffect(() => {
    muat();
    // Sinkron berjalan otomatis (lihat lib/auto-sync). Halaman cukup memuat ulang saat ada perubahan.
    window.addEventListener(EVENT_SINKRON, muat);
    window.addEventListener('online', muat);
    window.addEventListener('offline', muat);
    return () => {
      window.removeEventListener(EVENT_SINKRON, muat);
      window.removeEventListener('online', muat);
      window.removeEventListener('offline', muat);
    };
  }, []);

  if (!sesi) {
    return (
      <Card className="space-y-3">
        <p>Sesi Anda belum aktif. Masuk dengan email dan kata sandi untuk melanjutkan.</p>
        <a href="/masuk" className="tombol-utama w-full">Buka halaman Masuk</a>
      </Card>
    );
  }

  // Total saldo hanya ditampilkan kalau semua rekening aktif sudah punya saldo.
  const semuaAda = baris.length > 0 && baris.every((b) => b.saldo !== null);
  const totalSaldo = semuaAda ? baris.reduce((jml, b) => jml + Number(b.saldo), 0) : null;
  const selisih = ringkasan ? Number(ringkasan.selisih) : null;
  const selisihNegatif = selisih !== null && selisih < 0;

  const hariIni = now.getDate();
  const hariBulan = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const bulanLabel = `${NAMA_BULAN[now.getMonth()]} ${now.getFullYear()}`;
  const awalBulan = `01 ${NAMA_BULAN[now.getMonth()].slice(0, 3)}`;
  const akhirBulan = `${String(hariBulan).padStart(2, '0')} ${NAMA_BULAN[now.getMonth()].slice(0, 3)}`;

  // Perubahan saldo bulan ini: selisih dibanding saldo di awal bulan (saldo sekarang dikurangi selisih bulan ini).
  const saldoAwal = totalSaldo !== null && selisih !== null ? totalSaldo - selisih : null;
  const perubahanSaldo = saldoAwal !== null && saldoAwal > 0 && selisih !== null ? Math.round((selisih / saldoAwal) * 100) : null;
  const progresHari = hariIni > 0 ? Math.min(100, Math.round((catatan.hari / hariIni) * 100)) : 0;

  // Sudah mencatat hari ini? Transaksi terbaru sudah diurutkan dari tanggal terbaru.
  const sudahCatatHariIni = terbaru.length > 0 && terbaru[0].tanggal === tanggalLokal();

  // Tiga lencana dari data nyata. Ambang dipilih supaya mudah dipahami, bukan dari target bisnis.
  const lencana = [
    {
      judul: 'Pencatat rutin',
      sub: `${catatan.hari} hari tercatat`,
      raih: catatan.hari >= 5,
      ikon: 'M3 4h18v18H3zM8 2v4M16 2v4M3 10h18',
      warna: 'bg-[#f7efc9] text-[#b5901c]',
    },
    {
      judul: '10 catatan',
      sub: `${Math.min(catatan.jumlah, 10)} dari 10`,
      raih: catatan.jumlah >= 10,
      ikon: 'M5 4h14v16H5zM9 9h6M9 13h6',
      warna: 'bg-[#e8e6e5] text-[#504250]',
    },
    {
      judul: 'Selisih positif',
      sub: ringkasan ? (selisihNegatif ? 'Belum tercapai' : 'Pemasukan lebih besar') : 'Menunggu data',
      raih: ringkasan !== null && !selisihNegatif,
      ikon: 'M4 16l5-5 4 4 7-7M15 8h5v5',
      warna: 'bg-[#fde3e3] text-[#c2410c]',
    },
  ];

  return (
    <section className="space-y-5" aria-label="Beranda">
      {/* Greeting: avatar, salam, dan dua tombol ikon bulat, seperti baris atas layar AI Forecast. */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <a href="/app/pengaturan" aria-label="Ganti avatar di Pengaturan" className="shrink-0">
            <AvatarPengguna className="size-14" />
          </a>
          <div className="min-w-0">
            <p className={`truncate text-xl font-bold leading-tight ${UNGU}`}>
              Halo{nama ? `, ${nama}` : ''} <span aria-hidden="true">👋</span>
            </p>
            <p className="text-sm text-redup">{salamWaktu(now.getHours())}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a href="/app/transaksi/baru" aria-label="Catat transaksi" className={TOMBOL_IKON}>
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </a>
          <a href="/app/prakiraan" aria-label="Lihat prakiraan" className={TOMBOL_IKON}>
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
            </svg>
          </a>
        </div>
      </div>

      {!online && (
        <div className="rounded-[20px] bg-inset px-4 py-3 text-sm text-redup">Offline. Statistik dan saldo tampil lagi saat koneksi kembali.</div>
      )}
      {tertunda > 0 && (
        <div className="rounded-[20px] bg-inset px-4 py-3 text-sm text-redup" role="status">
          <strong className="tabular-nums text-teks">{tertunda}</strong>{' '}
          {online ? 'transaksi sedang dikirim ke server.' : 'transaksi menunggu koneksi. Dikirim otomatis saat terhubung.'}
        </div>
      )}
      {pesan && <p role="status" className="text-sm text-redup">{pesan}</p>}

      {/* Kartu hero: medali, label bulan, bilah progres, saldo besar, dan baris streak. */}
      <Card className="space-y-5 rounded-[32px] p-5">
        <div className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="grid size-24 shrink-0 place-items-center rounded-full bg-[radial-gradient(circle,#f7efc9_0%,#f3e6a8_52%,rgba(247,239,201,0)_74%)]"
          >
            <span className="grid size-14 place-items-center rounded-full border-2 border-[#c99a1e] text-[#c99a1e]">
              <svg viewBox="0 0 24 24" className="size-7" fill="currentColor" stroke="none">
                <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
              </svg>
            </span>
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <p className={`text-2xl font-bold ${UNGU}`}>{NAMA_BULAN[now.getMonth()]}</p>
              <p className="text-sm font-semibold text-redup tabular-nums">{catatan.jumlah} transaksi</p>
            </div>
            <div
              role="progressbar"
              aria-label="Hari tercatat dibanding hari berjalan"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progresHari}
              className="h-3 overflow-hidden rounded-full bg-[#e8e6e5]"
            >
              <div className="h-full rounded-full bg-gradient-to-r from-[#8fd45f] to-[#2f9e44] transition-[width] duration-500" style={{ width: `${progresHari}%` }} />
            </div>
          </div>
        </div>

        <div className="flex items-end justify-between gap-3">
          <p className="text-5xl leading-none tracking-tight sm:text-6xl" aria-live="polite">
            {totalSaldo === null ? '—' : <Uang nilai={totalSaldo} />}
          </p>
          {perubahanSaldo !== null && <DeltaBadge nilai={perubahanSaldo} className="mb-1 shrink-0" />}
        </div>

        <div className="flex items-center gap-3 rounded-[20px] bg-inset px-3 py-3">
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-[#f6e3fa] text-[#a63fc0]">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
            </svg>
          </span>
          <p className="min-w-0 truncate text-sm">
            <strong>{catatan.hari} hari tercatat!</strong>{' '}
            <span className="text-redup">dari {hariIni} hari berjalan bulan ini.</span>
          </p>
        </div>
      </Card>

      {/* Kartu misi: satu aksi nyata untuk hari ini. */}
      <div className="flex items-center justify-between gap-3 rounded-[28px] bg-inset p-4">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-permukaan text-[#8a20a5] shadow-sm">
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {sudahCatatHariIni ? <path d="M20 6 9 17l-5-5" /> : <path d="M12 5v14M5 12h14" />}
            </svg>
          </span>
          <div className="min-w-0">
            <p className="font-bold leading-tight">Misi hari ini</p>
            <p className="truncate text-sm">
              {sudahCatatHariIni ? (
                <span className="font-semibold text-[#1f6b3a]">Sudah mencatat hari ini</span>
              ) : (
                <>
                  <span className="font-semibold text-[#0051b5]">Catat transaksi</span>
                  <span className="text-redup"> hari ini</span>
                </>
              )}
            </p>
          </div>
        </div>
        {!sudahCatatHariIni && (
          <a href="/app/transaksi/baru" className="shrink-0 rounded-full bg-permukaan px-5 py-2.5 text-sm font-bold shadow-sm transition active:scale-95">
            Catat
          </a>
        )}
      </div>

      {/* Lencana: tiga kartu putih dengan lingkaran pastel. */}
      <section className="space-y-3" aria-labelledby="judul-lencana">
        <div className="flex items-baseline justify-between">
          <h2 id="judul-lencana" className="text-[22px] font-bold">Lencana</h2>
          <Pill>{lencana.filter((l) => l.raih).length} dari {lencana.length} tercapai</Pill>
        </div>
        <ul className="grid grid-cols-3 gap-3">
          {lencana.map((l) => (
            <li key={l.judul} className={`flex flex-col items-center gap-2 rounded-3xl bg-permukaan px-2 py-4 text-center shadow-[0_4px_20px_-2px_rgba(0,0,0,0.04)] ${l.raih ? '' : 'opacity-70'}`}>
              <span aria-hidden="true" className={`grid size-[72px] place-items-center rounded-full ${l.warna}`}>
                <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={l.ikon} />
                </svg>
              </span>
              <p className="text-sm font-bold leading-tight">{l.judul}</p>
              <p className={`text-xs font-bold leading-tight ${l.raih ? 'text-[#8a20a5]' : 'text-redup'}`}>{l.sub}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Kartu bulanan besar: pill ungu, selisih sebagai nominal, rentang tanggal, dan baris hasil. */}
      <div className="space-y-4 rounded-[32px] bg-inset p-5">
        <div className="flex items-start justify-between">
          <span aria-hidden="true" className="grid size-[72px] place-items-center rounded-full bg-[#f7efc9] text-[#b5901c]">
            <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
            </svg>
          </span>
          <a
            href="/app/laporan"
            aria-label="Buka laporan"
            className="grid size-12 place-items-center rounded-full bg-permukaan text-teks shadow-sm transition active:scale-95"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 17 17 7M8 7h9v9" />
            </svg>
          </a>
        </div>

        <div className="space-y-2">
          <span className="inline-block rounded-full bg-[#f6e3fa] px-4 py-1.5 text-sm font-bold text-[#8a20a5]">Selisih {bulanLabel}</span>
          <p className={`text-4xl leading-tight ${selisihNegatif ? 'text-[#ba1a1a]' : ''}`}>{selisih === null ? '—' : <Uang nilai={selisih} />}</p>
          <p className="text-sm text-redup">
            {awalBulan} – {akhirBulan} · {Math.max(0, hariBulan - hariIni)} hari lagi
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-[20px] bg-black/[0.04] px-4 py-3 text-sm">
          <span className="flex items-center gap-2 font-semibold">
            <svg viewBox="0 0 24 24" className={`size-5 ${selisihNegatif ? 'text-[#ba1a1a]' : 'text-[#1f6b3a]'}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="m8 12 3 3 5-6" />
            </svg>
            {ringkasan ? (selisihNegatif ? 'Pengeluaran melebihi pemasukan' : 'Pemasukan lebih besar') : 'Menunggu data'}
          </span>
          {ringkasan && <span className="shrink-0 font-bold text-[#1f6b3a] tabular-nums">+{rupiah(ringkasan.total_pemasukan)}</span>}
        </div>

        <a href="/app/prakiraan" className="tautan-ungu inline-block text-sm">Lihat prakiraan akhir bulan</a>
      </div>

      {/* Transaksi terbaru. */}
      <section className="space-y-3" aria-labelledby="judul-terbaru">
        <div className="flex items-baseline justify-between">
          <h2 id="judul-terbaru" className="text-[22px] font-bold">Transaksi terbaru</h2>
          <a href="/app/transaksi" className="tautan-ungu text-sm">Semua</a>
        </div>

        {terbaru.length === 0 && (
          <div className="rounded-[20px] border border-dashed border-garis bg-inset p-5 text-center text-redup">
            Belum ada transaksi bulan ini.{' '}
            <a href="/app/transaksi/baru" className="tautan-ungu">Catat transaksi</a>.
          </div>
        )}

        {terbaru.length > 0 && (
          <ul className="flex flex-col gap-2">
            {terbaru.map((t) => {
              const masuk = t.tipe === 'pemasukan';
              return (
                <li key={t.id} className="flex min-h-16 items-center gap-3 rounded-3xl bg-permukaan p-3.5 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.04)]">
                  <span
                    aria-hidden="true"
                    className={`grid size-12 shrink-0 place-items-center rounded-2xl ${masuk ? 'bg-[#e4f5d8] text-[#2f7a1f]' : 'bg-[#fde3e3] text-[#c2410c]'}`}
                  >
                    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      {masuk ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M5 12l7 7 7-7" />}
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{labelTipe(t.tipe)}</p>
                    <p className="truncate text-sm text-redup">
                      {t.tanggal}
                      {t.catatan ? ` · ${t.catatan}` : ''}
                    </p>
                  </div>
                  <p className={`shrink-0 text-lg font-bold tabular-nums ${masuk ? 'text-[#1f6b3a]' : ''}`}>
                    {masuk ? '+' : t.tipe === 'pengeluaran' ? '−' : ''}
                    {rupiah(t.jumlah)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Saldo per rekening. */}
      <section className="space-y-3" aria-labelledby="judul-rekening">
        <div className="flex items-baseline justify-between">
          <h2 id="judul-rekening" className="text-[22px] font-bold">Saldo rekening</h2>
          <a href="/app/pengaturan" className="tautan-ungu text-sm">Kelola</a>
        </div>

        {baris.length === 0 && (
          <div className="rounded-[20px] border border-dashed border-garis bg-inset p-5 text-center text-redup">
            Belum ada rekening.{' '}
            <a href="/app/pengaturan" className="tautan-ungu">Tambahkan rekening pertama</a>.
          </div>
        )}

        {baris.length > 0 && (
          <ul className="flex flex-col gap-2">
            {baris.map(({ rekening, saldo }) => (
              <li key={rekening.id} className="flex min-h-16 items-center justify-between gap-4 rounded-3xl bg-permukaan p-3.5 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.04)]">
                <div className="min-w-0 space-y-1">
                  <p className="truncate font-bold">{rekening.nama}</p>
                  <Pill className="capitalize">{rekening.jenis}</Pill>
                </div>
                <p className={`shrink-0 text-right text-lg font-bold tabular-nums ${saldo?.startsWith('-') ? 'text-[#ba1a1a]' : ''}`}>
                  {saldo === null ? '—' : rupiah(saldo)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
