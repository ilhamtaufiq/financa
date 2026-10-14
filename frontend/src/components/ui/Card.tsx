import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

// Kartu utama (putih, 24px) dan kartu inset (#f6f6f6, 20px), sesuai DESIGN.md "Cards & Grouping Planes".

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-3xl bg-permukaan p-6 shadow-[0_8px_32px_-4px_rgba(166,63,192,0.08)]', className)}>{children}</div>;
}

export function InsetCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-[20px] bg-inset p-5', className)}>{children}</div>;
}
