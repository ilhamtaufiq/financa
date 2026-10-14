import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

// Tombol ikon bulat, 44px supaya nyaman disentuh. aria-label wajib karena tidak ada teks.

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
}

export function IconButton({ label, children, className, ...sisa }: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        'grid size-11 shrink-0 place-items-center rounded-full bg-inset text-teks transition hover:bg-garis disabled:opacity-40',
        className,
      )}
      {...sisa}
    >
      {children}
    </button>
  );
}
