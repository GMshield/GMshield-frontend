'use client';

import { useId, useState } from 'react';

import { EXPORT_FORMATS, type ExportFormat } from '@/client/exports';
import { translator, type Language } from '@/messages';

import { ConfirmationDialog } from '../ConfirmationDialog';
import { PillButton } from '../PillButton';

import styles from './ArtifactExportDialog.module.css';
import { useArtifactExport } from './useArtifactExport';

/** A row of the list shown, as the dialog offers it: its artifact's id, its name and its detail (type, shared mark). */
export type ArtifactExportRow = {
  readonly id: string;
  readonly label: string;
  readonly detail: string | null;
};

export type ArtifactExportDialogProps = {
  /** The campaign the list is read in: its own artifacts and those shared into it. */
  readonly campaignId: string;
  /** The rows of the page shown, in list order (at most 50, the largest "Exibição" size). */
  readonly rows: readonly ArtifactExportRow[];
  readonly language: Language;
};

/**
 * "Exportar" above a list of artifacts (Story 5.7 part B: the campaign's artifacts tab, "Personagens"): a pill that
 * opens a dialog ({@link ConfirmationDialog}: focus opens on "Cancelar", Tab stays inside, Esc closes) listing the rows
 * of the page shown in list order, each a bordered row with its checkbox, name and detail. Nothing is ticked when it
 * opens, and PDF is the format chosen. Above the rows, two buttons pressed in words: "Selecionar todos" (pressed while
 * every row is ticked) and "Limpar seleção" (pressed while none is). Under the rows, a polite line says to tick one
 * while none is, else how many are ticked of how many; it describes "Exportar". Then the format, a radio group (PDF,
 * TXT, Markdown, JPG); with JPG chosen, one sentence under it says several artifacts come as a zip of images.
 * "Exportar" stays unavailable (`aria-disabled`) while nothing is ticked; pressed, it closes the dialog, focus goes
 * back to the pill, and the ticked ids go in list order through the routine the artifact page's menu shares
 * ({@link useArtifactExport}): one file, then one toast. The pill is busy, and ignores presses, while the file is read.
 */
export function ArtifactExportDialog({ campaignId, rows, language }: ArtifactExportDialogProps) {
  const t = translator(language);
  const { pending, exportAs } = useArtifactExport(campaignId, language);
  const [choosing, setChoosing] = useState(false);
  const [ticked, setTicked] = useState<readonly string[]>([]);
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const id = useId();
  const legendId = `${id}-legend`;
  const formatId = `${id}-format`;
  const zipNoteId = `${id}-zip`;
  const tallyId = `${id}-tally`;
  // In list order, and only rows still listed (the page may have been read again since the dialog opened).
  const chosen = rows.filter((row) => ticked.includes(row.id)).map((row) => row.id);

  const open = () => {
    setTicked([]);
    setFormat('pdf');
    setChoosing(true);
  };
  const confirm = () => {
    if (chosen.length === 0) {
      return;
    }
    setChoosing(false);
    void exportAs(chosen, format);
  };
  const toggle = (rowId: string, on: boolean) =>
    setTicked((current) => (on ? [...current.filter((other) => other !== rowId), rowId] : current.filter((other) => other !== rowId)));

  return (
    <>
      {/* aria-disabled, not disabled, while the file is read: the dialog gives focus back here. */}
      <PillButton
        aria-haspopup="dialog"
        aria-disabled={pending}
        pending={pending}
        onClick={() => {
          if (!pending) {
            open();
          }
        }}
      >
        {t('artifacts.export.action')}
      </PillButton>
      <ConfirmationDialog
        open={choosing}
        title={t('artifacts.export.title')}
        consequence={t('artifacts.export.consequence')}
        confirmLabel={t('artifacts.export.action')}
        confirmTone="solid"
        confirmDisabled={chosen.length === 0}
        confirmDescribedBy={tallyId}
        language={language}
        onConfirm={confirm}
        onCancel={() => setChoosing(false)}
      >
        <div className={styles.body}>
          <fieldset className={styles.artifacts} aria-labelledby={legendId}>
            <legend id={legendId} className={styles.legend}>
              {t('artifacts.export.legend')}
            </legend>
            <div className={styles.controls} role="group" aria-label={t('artifacts.export.controls')}>
              <button
                type="button"
                className={styles.control}
                aria-pressed={rows.length > 0 && chosen.length === rows.length}
                onClick={() => setTicked(rows.map((row) => row.id))}
              >
                {t('artifacts.export.selectAll')}
              </button>
              <button type="button" className={styles.control} aria-pressed={chosen.length === 0} onClick={() => setTicked([])}>
                {t('artifacts.export.clear')}
              </button>
            </div>
            <ul className={styles.rows}>
              {rows.map((row) => (
                <li key={row.id} className={styles.row}>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      value={row.id}
                      checked={ticked.includes(row.id)}
                      onChange={(event) => toggle(row.id, event.target.checked)}
                      aria-label={row.detail === null ? row.label : t('artifacts.export.row', { name: row.label, detail: row.detail })}
                    />
                    <span className={styles.text}>
                      <span className={styles.name}>{row.label}</span>
                      {row.detail === null ? null : <span className={styles.detail}>{row.detail}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {/* Why "Exportar" is unavailable, else how many rows are ticked (the rows scroll, so not all are in view). */}
            <p id={tallyId} className={styles.hint} aria-live="polite">
              {chosen.length === 0
                ? t('artifacts.export.tickNone')
                : chosen.length === 1
                  ? t('artifacts.export.tickedOne', { total: rows.length })
                  : t('artifacts.export.tickedOther', { count: chosen.length, total: rows.length })}
            </p>
          </fieldset>
          <fieldset className={styles.formats} aria-labelledby={formatId}>
            <legend id={formatId} className={styles.legend}>
              {t('artifacts.export.formatLegend')}
            </legend>
            <div className={styles.segments}>
              {EXPORT_FORMATS.map((each) => (
                <label key={each} className={styles.segment}>
                  <input
                    type="radio"
                    name={`${id}-formats`}
                    value={each}
                    className={styles.radio}
                    checked={format === each}
                    onChange={() => setFormat(each)}
                    aria-describedby={each === 'jpg' && format === 'jpg' ? zipNoteId : undefined}
                  />
                  <span className={styles.segmentLabel}>{t(`artifacts.export.${each}`)}</span>
                </label>
              ))}
            </div>
            {format === 'jpg' ? (
              <p id={zipNoteId} className={styles.hint}>
                {t('artifacts.export.zipNote')}
              </p>
            ) : null}
          </fieldset>
        </div>
      </ConfirmationDialog>
    </>
  );
}
