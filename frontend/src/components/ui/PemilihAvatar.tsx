import { useEffect, useState } from 'react';
import { ambilSesi } from '../../lib/api';
import { ambilAvatar, DAFTAR_AVATAR, namaAvatar, simpanAvatar, urlAvatar } from '../../lib/avatar';
import { cn } from '../../lib/cn';

// Grid pilihan avatar. Memakai radiogroup supaya bisa dioperasikan dengan keyboard dan dibaca pembaca layar.

export function PemilihAvatar() {
  const [terpilih, setTerpilih] = useState<string | null>(null);
  const email = ambilSesi()?.email;

  useEffect(() => {
    setTerpilih(ambilAvatar(email));
  }, [email]);

  function pilih(id: string) {
    simpanAvatar(id, email);
    setTerpilih(id);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        {terpilih && (
          <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-full bg-[#f6e3fa] shadow-sm ring-4 ring-white">
            <img src={urlAvatar(terpilih)} alt="" width={64} height={64} className="size-full object-contain" />
          </span>
        )}
        <div>
          <p className="font-bold">{terpilih ? namaAvatar(terpilih) : 'Memuat…'}</p>
          <p className="text-sm text-redup">Pilih avatar yang tampil di pojok kanan atas. Tersimpan di perangkat ini.</p>
        </div>
      </div>

      <div role="radiogroup" aria-label="Pilih avatar" className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {DAFTAR_AVATAR.map((a) => {
          const aktif = a.id === terpilih;
          return (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={aktif}
              aria-label={a.nama}
              onClick={() => pilih(a.id)}
              className={cn(
                'grid aspect-square place-items-center rounded-2xl bg-inset p-1.5 transition active:scale-95',
                aktif ? 'bg-[#e4f5d8] ring-2 ring-[#2f9e44]' : 'hover:bg-garis',
              )}
            >
              <img src={urlAvatar(a.id)} alt="" width={64} height={64} loading="lazy" className="size-full object-contain" />
            </button>
          );
        })}
      </div>

      <p className="text-xs text-redup">Avatar oleh Kenney (kenney.nl), lisensi CC0.</p>
    </div>
  );
}
