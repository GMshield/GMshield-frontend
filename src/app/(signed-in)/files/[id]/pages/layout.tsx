import type { ReactNode } from 'react';

import { FullScreenFrame } from '@/components/FullScreen';

/**
 * Around a material's pages (2026-11-23): the full-screen frame. A layout, not the page, so the frame stays mounted, and
 * stays in full screen, while the GM turns from one page to the next.
 */
export default function MaterialPagesLayout({ children }: { readonly children: ReactNode }) {
  return <FullScreenFrame>{children}</FullScreenFrame>;
}
