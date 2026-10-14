import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

// Label netral berbentuk pill, misalnya persentase kontribusi atau jenis rekening.

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full bg-inset px-3 py-1 text-xs font-bold tabular-nums text-teks', className)}>
      {children}
    </span>
  );
}
