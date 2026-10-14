import { useEffect, useState } from 'react';
import { ambilSesi } from '../../lib/api';
import { ambilAvatar, EVENT_AVATAR, namaAvatar, urlAvatar } from '../../lib/avatar';
import { cn } from '../../lib/cn';

// Avatar pengguna dalam lingkaran. Dibaca setelah komponen tampil di browser (bukan saat render pertama),
// dan diperbarui otomatis saat pengguna memilih avatar lain di Pengaturan.

export function AvatarPengguna({ className }: { className?: string }) {
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    const perbarui = () => setId(ambilAvatar(ambilSesi()?.email));
    perbarui();
    window.addEventListener(EVENT_AVATAR, perbarui);
    return () => window.removeEventListener(EVENT_AVATAR, perbarui);
  }, []);

  const dasar = 'grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#f6e3fa] ring-2 ring-white';

  if (!id) return <span aria-hidden="true" className={cn(dasar, className)} />;
  return (
    <span className={cn(dasar, className)}>
      <img src={urlAvatar(id)} alt={`Avatar: ${namaAvatar(id)}`} width={64} height={64} className="size-full object-contain" />
    </span>
  );
}
