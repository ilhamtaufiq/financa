import { useState } from 'react';

// Input kata sandi dengan tombol tampilkan/sembunyikan. Tombol memakai aria-pressed
// supaya pengguna pembaca layar tahu statusnya.

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (nilai: string) => void;
  autoComplete: 'current-password' | 'new-password';
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
}

export default function CampoKataSandi({ id, label, value, onChange, autoComplete, invalid, describedBy, autoFocus }: Props) {
  const [tampil, setTampil] = useState(false);

  return (
    <div>
      <label className="label-form" htmlFor={id}>{label}</label>
      <div className="relative">
        <input
          id={id}
          type={tampil ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          className="masukan pr-12"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          autoFocus={autoFocus}
        />
        <button
          type="button"
          onClick={() => setTampil((t) => !t)}
          aria-label={tampil ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
          aria-controls={id}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-redup transition hover:text-cendera focus-visible:text-cendera"
        >
          {tampil ? (
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9.8 9.8 0 0112 4.9c5 0 8.5 4.2 9.5 6.6a10.8 10.8 0 01-2.1 3.2M6.6 6.6A11.6 11.6 0 002.5 11.5c1 2.4 4.5 6.6 9.5 6.6a9.8 9.8 0 005.1-1.4" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7S2.5 12 2.5 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
