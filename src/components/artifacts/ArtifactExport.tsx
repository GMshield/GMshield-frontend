'use client';

import { useId } from 'react';

import { EXPORT_FORMATS, type ExportFormat } from '@/client/exports';
import { translator, type Language } from '@/messages';

import { NamedIcon } from '../Icons';
import { PillButton } from '../PillButton';
import { useDisclosure } from '../useDisclosure';

import styles from './ArtifactExport.module.css';
import { useArtifactExport } from './useArtifactExport';

export type ArtifactExportProps = {
  /** The campaign the artifacts are read in: their own, or the one they are shared into. */
  readonly campaignId: string;
  /** The artifacts to export, in the order the file holds them (one on an artifact's page). */
  readonly ids: readonly string[];
  readonly language: Language;
};

/**
 * "Exportar" (Story 5.7 part A): a pill that opens the export formats under it (PDF, TXT, Markdown, JPG), as
 * "Exibição" opens its options ({@link useDisclosure}: Esc gives focus back to the pill, a press outside closes it).
 * Choosing a format closes the list, gives focus back to the pill, reads the file through this site's relay and hands
 * it to the browser as a download; a toast then says the export is ready, naming the file, or why it failed (the
 * artifact is gone, it is too long for PDF or JPG, or other exports are running: try again). While the
 * file is read the pill shows that it is busy and ignores presses (`aria-disabled`, so focus stays on it). It takes the
 * artifacts' ids, so a list's selection can use it too.
 *
 * Story 5.7 part B: the fetch, the download and the toasts are {@link useArtifactExport}, which the lists' dialog
 * (`ArtifactExportDialog`) shares; for one artifact they are part A's.
 */
export function ArtifactExport({ campaignId, ids, language }: ArtifactExportProps) {
  const t = translator(language);
  const { open, setOpen, container, button } = useDisclosure();
  const { pending, exportAs: run } = useArtifactExport(campaignId, language);
  const id = useId();

  const exportAs = async (format: ExportFormat) => {
    setOpen(false);
    button.current?.focus();
    await run(ids, format);
  };

  return (
    <div ref={container} className={styles.menu}>
      <PillButton
        ref={button}
        aria-expanded={open}
        aria-controls={id}
        aria-disabled={pending}
        pending={pending}
        onClick={() => {
          if (!pending) {
            setOpen(!open);
          }
        }}
      >
        {t('artifacts.export.action')}
        <NamedIcon name="chevronDown" size={16} />
      </PillButton>
      <ul id={id} aria-label={t('artifacts.export.menu')} className={styles.panel} hidden={!open}>
        {EXPORT_FORMATS.map((format) => (
          <li key={format}>
            <button type="button" className={styles.format} onClick={() => void exportAs(format)}>
              {t(`artifacts.export.${format}`)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
