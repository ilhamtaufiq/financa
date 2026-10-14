import * as Select from '@radix-ui/react-select';

// Dropdown berbasis Radix Select: keyboard (panah, Home/End, ketik huruf pertama), pembaca layar, dan fokus sudah benar.
// Tampilan mengikuti aplikasi: pemicu seperti kolom input, daftar berupa kartu putih bersudut besar.
// Nilainya string seperti <select>. Pilihan "kosong" (nilai '') dipetakan ke sentinel karena Radix menolak item bernilai kosong.

const KOSONG = '__kosong__';

export interface PilihanDropdown {
  nilai: string;
  label: string;
}

interface Props {
  id: string;
  nilai: string;
  onUbah: (nilai: string) => void;
  pilihan: PilihanDropdown[];
  /** Teks saat belum ada pilihan, mis. "Pilih rekening". */
  placeholder?: string;
  /** Jika diisi, ditambahkan pilihan paling atas bernilai '' dengan label ini, mis. "Tanpa kategori". */
  kosong?: string;
}

const KELAS_ITEM =
  'relative flex min-h-12 cursor-pointer select-none items-center justify-between gap-3 rounded-2xl px-4 py-3 text-base outline-none ' +
  'data-[highlighted]:bg-inset data-[state=checked]:bg-[#e4f5d8] data-[state=checked]:font-bold';

function Centang() {
  return (
    <Select.ItemIndicator>
      <svg viewBox="0 0 24 24" className="size-5 text-[#2f7a1f]" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </Select.ItemIndicator>
  );
}

export function Dropdown({ id, nilai, onUbah, pilihan, placeholder, kosong }: Props) {
  const nilaiRadix = nilai === '' ? (kosong ? KOSONG : undefined) : nilai;

  return (
    <Select.Root value={nilaiRadix} onValueChange={(v) => onUbah(v === KOSONG ? '' : v)}>
      <Select.Trigger
        id={id}
        className="masukan flex items-center justify-between gap-3 text-left data-[placeholder]:text-redup"
      >
        <Select.Value placeholder={placeholder} />
        <Select.Icon>
          <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-redup" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={8}
          collisionPadding={16}
          className="z-[60] max-h-[min(20rem,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-3xl bg-permukaan p-2 shadow-[0_16px_48px_-8px_rgba(60,40,120,0.28)] motion-safe:animate-[naik_160ms_cubic-bezier(0.2,0.8,0.2,1)]"
        >
          <Select.Viewport>
            {kosong && (
              <Select.Item value={KOSONG} className={KELAS_ITEM}>
                <Select.ItemText>{kosong}</Select.ItemText>
                <Centang />
              </Select.Item>
            )}
            {pilihan.map((p) => (
              <Select.Item key={p.nilai} value={p.nilai} className={KELAS_ITEM}>
                <Select.ItemText>{p.label}</Select.ItemText>
                <Centang />
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
