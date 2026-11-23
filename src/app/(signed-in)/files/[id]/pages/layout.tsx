import type { ReactNode } from 'react';

import { FullScreenFrame } from '@/components/FullScreen';
import { PageZoomProvider } from '@/components/PageZoom';

/**
 * Around a material's pages (2026-11-23): the full-screen frame and the zoom level. A layout, not the page, so the frame
 * stays mounted, and stays in full screen, and the zoom stays where the GM put it, while the GM turns the page.
 */
export default function MaterialPagesLayout({ children }: { readonly children: ReactNode }) {
  return (
    <FullScreenFrame>
      <PageZoomProvider>{children}</PageZoomProvider>
    </FullScreenFrame>
  );
}
