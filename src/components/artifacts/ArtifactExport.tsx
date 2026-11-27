'use client';

import { useId, useState } from 'react';

import { EXPORT_FORMATS, fetchExport, type ExportFormat } from '@/client/exports';
import { errorText, problemFields, translator, type Language } from '@/messages';

import { NamedIcon } from '../Icons';
import { useNotifications } from '../notifications/NotificationsProvider';
import { PillButton } from '../PillButton';
import { useDisclosure } from '../useDisclosure';

import styles from './ArtifactExport.module.css';

export type ArtifactExportProps = {
  /** The campaign the artifacts are read in: their own, or the one they are shared into. */
  readonly campaignId: string;
  /** The artifacts to export, in the order the file holds them (one on an artifact's page). */
  readonly ids: readonly string[];
  readonly language: Language;
};

/** A file's extension, should the relay not name the file: several JPG images come as one zip. */
function extension(format: ExportFormat, count: number): string {
  if (format === 'markdown') {
    return 'md';
  }
  return format === 'jpg' && count > 1 ? 'zip' : format;
}

/** Hands a file to the browser as a download, then lets its address go. */
function download(file: Blob, name: string): void {
  const address = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = address;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // The download has started from the click; the address is let go once it has been read.
  setTimeout(() => URL.revokeObjectURL(address), 1000);
}

/**
 * "Exportar" (Story 5.7 part A): a pill that opens the export formats under it (PDF, TXT, Markdown, JPG), as
 * "Exibição" opens its options ({@link useDisclosure}: Esc gives focus back to the pill, a press outside closes it).
 * Choosing a format closes the list, gives focus back to the pill, reads the file through this site's relay and hands
 * it to the browser as a download; a toast then says the export is ready, naming the file, or why it failed (the
 * artifact is gone, it is too long for PDF or JPG, or other exports are running: try again). While the
 * file is read the pill shows that it is busy and ignores presses (`aria-disabled`, so focus stays on it). It takes the
 * artifacts' ids, so a list's selection can use it too.
 */
export function ArtifactExport({ campaignId, ids, language }: ArtifactExportProps) {
  const t = translator(language);
  const { notify } = useNotifications();
  const { open, setOpen, container, button } = useDisclosure();
  const [pending, setPending] = useState(false);
  const id = useId();

  /** Why the export failed: the artifact gone, too long for PDF or JPG, the exports busy, else the problem's text. */
  const refusalText = (status: number, problem: unknown): string => {
    const { code } = problemFields(problem);
    if (code === 'artifact.export_too_large') {
      return t('artifacts.export.tooLarge');
    }
    if (code === 'artifact.export_busy') {
      return t('artifacts.export.busy');
    }
    return status === 404 ? t('artifacts.export.notFound') : errorText(problem, language);
  };

  const exportAs = async (format: ExportFormat) => {
    setOpen(false);
    button.current?.focus();
    setPending(true);
    try {
      const exported = await fetchExport(campaignId, ids, format, `${t('artifacts.export.file')}.${extension(format, ids.length)}`);
      if (exported.ok) {
        download(exported.file, exported.name);
        notify({ status: 'success', message: t('artifacts.export.done', { file: exported.name }) });
      } else {
        notify({ status: 'danger', message: refusalText(exported.status, exported.problem) });
      }
    } finally {
      setPending(false);
    }
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
