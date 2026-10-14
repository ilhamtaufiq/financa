import { useLayoutEffect, useRef, type ChangeEvent } from 'react';
import { cn } from '../../lib/cn';
import { keNilaiMentah, keTampilan } from '../../lib/uang-input';

// Input uang dengan format Rupiah saat mengetik: "1250000" tampil "1.250.000", dengan awalan "Rp" di dalam kolom.
// `nilai` dan `onUbah` memakai nilai mentah (tanpa titik ribuan, titik sebagai desimal), sama dengan yang dikirim ke server.

interface Props {
  id: string;
  nilai: string;
  onUbah: (mentah: string) => void;
  /** Izinkan tanda minus di depan, mis. untuk saldo awal negatif. */
  negatif?: boolean;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
}

/** Jumlah karakter bermakna (angka, koma, minus) sebelum posisi kursor. Dipakai untuk memulihkan kursor setelah format ulang. */
function hitungBermakna(teks: string, sampai: number): number {
  return (teks.slice(0, sampai).match(/[\d,-]/g) ?? []).length;
}

export function InputRupiah({ id, nilai, onUbah, negatif, placeholder, invalid, describedBy, className }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const kursor = useRef<number | null>(null);
  const tampil = keTampilan(nilai);

  // Setelah teks diformat ulang, kembalikan kursor ke tempat yang sama relatif terhadap angka yang diketik.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || kursor.current === null || document.activeElement !== el) return;
    const target = kursor.current;
    kursor.current = null;

    let posisi = 0;
    if (target > 0) {
      posisi = tampil.length;
      let hitung = 0;
      for (let i = 0; i < tampil.length; i++) {
        if (/[\d,-]/.test(tampil[i])) hitung++;
        if (hitung === target) {
          posisi = i + 1;
          break;
        }
      }
    }
    el.setSelectionRange(posisi, posisi);
  }, [tampil]);

  function ubah(e: ChangeEvent<HTMLInputElement>) {
    const teks = e.target.value;
    kursor.current = hitungBermakna(teks, e.target.selectionStart ?? teks.length);
    onUbah(keNilaiMentah(teks, { negatif }));
  }

  return (
    <div className="relative">
      <span aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-bold text-redup">
        Rp
      </span>
      <input
        ref={ref}
        id={id}
        type="text"
        inputMode={negatif ? 'text' : 'decimal'}
        autoComplete="off"
        className={cn('masukan pl-12 tabular-nums', className)}
        value={tampil}
        placeholder={placeholder}
        aria-invalid={invalid ? 'true' : 'false'}
        aria-describedby={describedBy}
        onChange={ubah}
      />
    </div>
  );
}
