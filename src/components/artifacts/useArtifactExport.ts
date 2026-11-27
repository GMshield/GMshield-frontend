'use client';

import { useState } from 'react';

import { fetchExport, type ExportFormat } from '@/client/exports';
import { errorText, problemFields, translator, type Language } from '@/messages';

import { useNotifications } from '../notifications/NotificationsProvider';

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

export type ArtifactExportRun = {
  /** Whether a file is being read: the pill that started it shows it is busy and ignores presses. */
  readonly pending: boolean;
  /** Reads the export of `ids` (in that order) as `format`, hands it to the browser and says how it went in a toast. */
  readonly exportAs: (ids: readonly string[], format: ExportFormat) => Promise<void>;
};

/**
 * The export routine that the artifact page's menu (Story 5.7 part A) and the lists' dialog (part B) share: it reads the
 * file through this site's relay, hands it to the browser as a download, and a toast then says the export is ready,
 * naming the file, or why it failed. The messages follow how many artifacts were asked for: one ("Este artefato…", the
 * file named "artefato" should the relay not name it) or several ("Um dos artefatos escolhidos…", "artefatos"). Being
 * busy (other exports running) reads the same for both.
 */
export function useArtifactExport(campaignId: string, language: Language): ArtifactExportRun {
  const t = translator(language);
  const { notify } = useNotifications();
  const [pending, setPending] = useState(false);

  /** Why the export failed: an artifact gone, too long for PDF or JPG, the exports busy, else the problem's text. */
  const refusalText = (status: number, problem: unknown, several: boolean): string => {
    const { code } = problemFields(problem);
    if (code === 'artifact.export_too_large') {
      return t(several ? 'artifacts.export.tooLargeSeveral' : 'artifacts.export.tooLarge');
    }
    if (code === 'artifact.export_busy') {
      return t('artifacts.export.busy');
    }
    if (status === 404) {
      return t(several ? 'artifacts.export.notFoundSeveral' : 'artifacts.export.notFound');
    }
    return errorText(problem, language);
  };

  const exportAs = async (ids: readonly string[], format: ExportFormat) => {
    const several = ids.length > 1;
    setPending(true);
    try {
      const fallback = `${t(several ? 'artifacts.export.files' : 'artifacts.export.file')}.${extension(format, ids.length)}`;
      const exported = await fetchExport(campaignId, ids, format, fallback);
      if (exported.ok) {
        download(exported.file, exported.name);
        notify({ status: 'success', message: t('artifacts.export.done', { file: exported.name }) });
      } else {
        notify({ status: 'danger', message: refusalText(exported.status, exported.problem, several) });
      }
    } finally {
      setPending(false);
    }
  };

  return { pending, exportAs };
}
