// Avatar pengguna: hewan dari Kenney "Cube Pets" (CC0, www.kenney.nl).
// Pilihan disimpan di perangkat (localStorage), per email, karena backend belum punya profil pengguna.
// Pemakaian pertama mendapat avatar acak, lalu tetap sama sampai pengguna memilih yang lain.

export interface Avatar {
  id: string;
  nama: string;
}

export const DAFTAR_AVATAR: Avatar[] = [
  { id: 'beaver', nama: 'Berang-berang' },
  { id: 'bee', nama: 'Lebah' },
  { id: 'bunny', nama: 'Kelinci' },
  { id: 'cat', nama: 'Kucing' },
  { id: 'caterpillar', nama: 'Ulat' },
  { id: 'chick', nama: 'Anak ayam' },
  { id: 'cow', nama: 'Sapi' },
  { id: 'crab', nama: 'Kepiting' },
  { id: 'deer', nama: 'Rusa' },
  { id: 'dog', nama: 'Anjing' },
  { id: 'elephant', nama: 'Gajah' },
  { id: 'fish', nama: 'Ikan' },
  { id: 'fox', nama: 'Rubah' },
  { id: 'giraffe', nama: 'Jerapah' },
  { id: 'hog', nama: 'Babi hutan' },
  { id: 'koala', nama: 'Koala' },
  { id: 'lion', nama: 'Singa' },
  { id: 'monkey', nama: 'Monyet' },
  { id: 'panda', nama: 'Panda' },
  { id: 'parrot', nama: 'Beo' },
  { id: 'penguin', nama: 'Pinguin' },
  { id: 'pig', nama: 'Babi' },
  { id: 'polar', nama: 'Beruang kutub' },
  { id: 'tiger', nama: 'Harimau' },
];

/** Event di `window` saat avatar berubah, supaya header ikut diperbarui tanpa memuat ulang halaman. */
export const EVENT_AVATAR = 'financa:avatar';

const KUNCI = 'financa.avatar';

function kunciUntuk(email: string | undefined): string {
  return email ? `${KUNCI}.${email.toLowerCase()}` : KUNCI;
}

function valid(id: string | null): id is string {
  return id !== null && DAFTAR_AVATAR.some((a) => a.id === id);
}

export function urlAvatar(id: string): string {
  return `/avatar/${id}.png`;
}

export function namaAvatar(id: string): string {
  return DAFTAR_AVATAR.find((a) => a.id === id)?.nama ?? 'Avatar';
}

/**
 * Avatar pengguna. Jika belum pernah dipilih, diacak sekali lalu disimpan agar tidak berganti tiap kali dibuka.
 * Jika localStorage tidak tersedia (mode privat tertentu), hasilnya acak tiap panggilan.
 */
export function ambilAvatar(email?: string): string {
  const kunci = kunciUntuk(email);
  try {
    const tersimpan = localStorage.getItem(kunci);
    if (valid(tersimpan)) return tersimpan;
  } catch {
    // Lanjut ke avatar acak di bawah.
  }
  const acak = DAFTAR_AVATAR[Math.floor(Math.random() * DAFTAR_AVATAR.length)].id;
  try {
    localStorage.setItem(kunci, acak);
  } catch {
    // Tidak tersimpan: avatar berganti saat halaman dimuat ulang.
  }
  return acak;
}

export function simpanAvatar(id: string, email?: string): void {
  if (!valid(id)) return;
  try {
    localStorage.setItem(kunciUntuk(email), id);
  } catch {
    // Tidak tersimpan: pilihan hanya berlaku sampai halaman dimuat ulang.
  }
  window.dispatchEvent(new Event(EVENT_AVATAR));
}
