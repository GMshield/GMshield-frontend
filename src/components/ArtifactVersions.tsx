'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { startTransition, useActionState, useId, useState } from 'react';

import { NO_ARTIFACT_RESTORE, type ArtifactRestoreState } from '@/app/(signed-in)/campaigns/[id]/artifacts/form-state';
import type { Language } from '@/messages';
import type { Paging } from '@/paging';

import styles from './ArtifactVersions.module.css';
import { Pager } from './Pager';
import { PillButton } from './PillButton';

/** One version as its row shows it: its number, its line ("Versão 2 · Espada de Kael · 26 de nov. de 2026") and page. */
export type ArtifactVersionRow = {
  readonly number: number;
  readonly label: string;
  readonly href: string;
  /** Whether it is the artifact's newest version. */
  readonly current: boolean;
  /** Whether it is the version the page shows. */
  readonly shown: boolean;
};

/** Every text of the section, in the interface's language: `restoreOf` holds `{number}`. */
export type ArtifactVersionsTexts = {
  readonly title: string;
  readonly list: string;
  readonly current: string;
  readonly restore: string;
  readonly restoreOf: string;
  readonly stale: string;
  readonly viewCurrent: string;
  readonly keepMine: string;
};

export type ArtifactVersionsProps = {
  readonly campaignId: string;
  readonly artifactId: string;
  /** The artifact's newest version as the page read it: a restore names it. */
  readonly currentVersion: number;
  /** The rows of the page of versions shown, newest first. */
  readonly rows: readonly ArtifactVersionRow[];
  /** Where those rows stand among all the versions, and the page's address (its query kept by every page link). */
  readonly pages: { readonly paging: Paging; readonly path: string; readonly query: Readonly<Record<string, string>> };
  /** Posted with a restore: the page shows an earlier version, so a restore goes on to the newest one. */
  readonly older: boolean;
  /** Posted with a restore: where the page was opened from ("Personagens"), kept when it moves on. */
  readonly from: string | null;
  readonly texts: ArtifactVersionsTexts;
  readonly language: Language;
  readonly action: (previous: ArtifactRestoreState, form: FormData) => Promise<ArtifactRestoreState>;
};

function fill(text: string, params: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : placeholder));
}

/**
 * "Versões" on an artifact's page (Story 5.2): its versions newest first, a page at a time ({@link Pager} under them),
 * one row each, modelled on a material's superseded versions. A row's line opens that version (`?version=N`), the
 * newest carries the tag "atual", and every other row has "Restaurar", which copies that version as the newest (nothing
 * is deleted, so nothing asks for confirmation); the toast "Versão N restaurada." says it is done. A restore the backend
 * finds stale says "Este item mudou em outra aba." under the rows with "Ver a versão atual" (the page read again) and
 * "Manter a minha como nova versão" (the same restore sent again on the newest version); another refusal shows as an
 * alert there. While a restore runs every "Restaurar" stays focusable but ignores clicks (`aria-disabled`), and the one
 * pressed shows the spinner.
 */
export function ArtifactVersions({
  campaignId,
  artifactId,
  currentVersion,
  rows,
  pages,
  older,
  from,
  texts,
  language,
  action,
}: ArtifactVersionsProps) {
  const router = useRouter();
  const headingId = useId();
  const [state, dispatch, pending] = useActionState(action, NO_ARTIFACT_RESTORE);
  const [pressed, setPressed] = useState<number | null>(null);
  // The answer a "Ver a versão atual" set aside: its notice is no longer shown.
  const [dismissed, setDismissed] = useState(0);
  const send = (number: number, on: number) => {
    const data = new FormData();
    data.set('campaignId', campaignId);
    data.set('artifactId', artifactId);
    data.set('number', String(number));
    data.set('version', String(on));
    data.set('view', older ? 'older' : 'current');
    if (from !== null) {
      data.set('from', from);
    }
    setPressed(number);
    startTransition(() => dispatch(data));
  };
  const answered = state.serial > dismissed && !state.saved;
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {texts.title}
      </h2>
      <ul className={styles.list} aria-label={texts.list}>
        {rows.map((row) => (
          <li key={row.number} className={styles.row} data-version={row.number}>
            <Link className={styles.link} href={row.href} aria-current={row.shown ? 'page' : undefined}>
              {row.label}
            </Link>
            {row.current ? (
              <span className={styles.tag}>{texts.current}</span>
            ) : (
              <PillButton
                aria-label={fill(texts.restoreOf, { number: row.number })}
                aria-disabled={pending}
                pending={pending && pressed === row.number}
                onClick={() => {
                  if (!pending) {
                    send(row.number, currentVersion);
                  }
                }}
              >
                {texts.restore}
              </PillButton>
            )}
          </li>
        ))}
      </ul>
      <Pager paging={pages.paging} path={pages.path} query={pages.query} language={language} compact />
      {answered && state.stale ? (
        <div role="alert" className={styles.stale}>
          <span>{texts.stale}</span>
          <div className={styles.choices}>
            <PillButton
              onClick={() => {
                setDismissed(state.serial);
                router.refresh();
              }}
            >
              {texts.viewCurrent}
            </PillButton>
            <PillButton
              disabled={pending || state.currentVersion === null || state.number === null}
              onClick={() => state.currentVersion !== null && state.number !== null && send(state.number, state.currentVersion)}
            >
              {texts.keepMine}
            </PillButton>
          </div>
        </div>
      ) : null}
      {answered && !state.stale && state.error !== null ? (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      ) : null}
    </section>
  );
}
