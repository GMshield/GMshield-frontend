'use client';

import { SolidPillButton } from './PillButton';
import { useUploads } from './uploads/UploadsProvider';

/** "Adicionar Arquivo" as a list page's main action (Story 3.3): it opens the guided upload, as the sidebar's does. */
export function AddFileButton({ label }: { readonly label: string }) {
  const { openUpload } = useUploads();
  return (
    <SolidPillButton aria-haspopup="dialog" onClick={() => openUpload()}>
      {label}
    </SolidPillButton>
  );
}
