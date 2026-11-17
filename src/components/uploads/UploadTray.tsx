'use client';

import Link from 'next/link';
import { useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react';

import { PillButton } from '../PillButton';
import { StatePill } from '../StatePill';
import { useRefreshWhileMoving } from '../useRefreshWhileMoving';

import { fill, formatSize, MOVING_STATES, problemText, type Material, type MaterialState, type UploadTexts } from './types';
import styles from './Uploads.module.css';
import { UPLOAD_LIFETIME_MS, useUploads, type LiveUpload, type StoredUpload } from './UploadsProvider';

/** How often the tray asks for fresh rows while one of them is moving and the tab is visible. */
export { REFRESH_MS } from '../useRefreshWhileMoving';

/** Pages done of the total, once the backend knows the total (Story 1.15). */
type Pages = { readonly done: number; readonly total: number };

/** One row of the tray, from the server, from this tab, or from a stored resume entry. */
export type TrayRow =
  | { readonly kind: 'material'; readonly key: string; readonly materialId: string; readonly name: string; readonly state: MaterialState; readonly sent: number; readonly total: number; readonly pages?: Pages }
  | { readonly kind: 'live'; readonly key: string; readonly materialId: string | null; readonly name: string; readonly state: MaterialState; readonly sent: number; readonly total: number; readonly problem: unknown }
  | { readonly kind: 'interrupted'; readonly key: string; readonly materialId: string; readonly name: string; readonly uploadId: string; readonly sent: number; readonly total: number; readonly expiresAt: string; readonly problem: unknown }
  | { readonly kind: 'gone'; readonly key: string; readonly materialId: string | null; readonly name: string; readonly dismissKeys: readonly string[] };

const ACTIVE = new Set<LiveUpload['phase']>(['queued', 'uploading']);

function liveState(upload: LiveUpload): MaterialState {
  return upload.phase === 'failed' ? 'failed' : upload.phase === 'waiting' ? 'waiting' : 'uploading';
}

/**
 * The tray's rows: the server's, merged with this tab's live uploads, then stored resume entries that outlived the
 * 6 hours. A server row still `uploading` with no live upload here is interrupted (Retomar), or gone once past its
 * expiry. Rows the GM dismissed are left out.
 */
export function trayRows(
  rows: readonly Material[],
  live: readonly LiveUpload[],
  stored: readonly StoredUpload[],
  dismissed: ReadonlySet<string>,
  now: number | null,
): TrayRow[] {
  const result: TrayRow[] = [];
  const matched = new Set<string>();
  const server: TrayRow[] = [];
  for (const row of rows) {
    if (dismissed.has(row.id)) {
      continue;
    }
    // Every live upload of this material is shown by this row; the newest (first) decides its state.
    const mine = live.filter((upload) => (upload.uploadId !== null && upload.uploadId === row.upload?.id) || upload.materialId === row.id);
    for (const upload of mine) {
      matched.add(upload.key);
    }
    const newest = mine[0];
    if (newest !== undefined && ACTIVE.has(newest.phase)) {
      server.push({ kind: 'live', key: row.id, materialId: row.id, name: row.name, state: 'uploading', sent: newest.sent, total: newest.size, problem: null });
    } else if (newest?.phase === 'waiting' && row.state === 'uploading') {
      // Verified here before the server's rows caught up: waiting, not interrupted.
      server.push({ kind: 'live', key: row.id, materialId: row.id, name: row.name, state: 'waiting', sent: newest.size, total: newest.size, problem: null });
    } else if (row.state === 'uploading' && row.upload !== undefined) {
      const expired = now !== null && Date.parse(row.upload.expiresAt) <= now;
      server.push(
        expired
          ? { kind: 'gone', key: row.id, materialId: row.id, name: row.name, dismissKeys: [row.id, row.upload.id] }
          : {
              kind: 'interrupted',
              key: row.id,
              materialId: row.id,
              name: row.name,
              uploadId: row.upload.id,
              sent: row.upload.offset,
              total: row.upload.length,
              expiresAt: row.upload.expiresAt,
              problem: newest?.phase === 'failed' ? newest.problem : null,
            },
      );
    } else {
      // Pages fill the line only while processing; any other state keeps a full line.
      server.push(
        row.pages === undefined || row.state !== 'processing'
          ? { kind: 'material', key: row.id, materialId: row.id, name: row.name, state: row.state, sent: 1, total: 1 }
          : { kind: 'material', key: row.id, materialId: row.id, name: row.name, state: row.state, sent: row.pages.done, total: row.pages.total, pages: row.pages },
      );
    }
  }
  for (const upload of live) {
    if (matched.has(upload.key) || dismissed.has(upload.key)) {
      continue;
    }
    result.push({
      kind: 'live',
      key: upload.key,
      materialId: upload.materialId,
      name: upload.name,
      state: liveState(upload),
      sent: upload.phase === 'waiting' ? upload.size : upload.sent,
      total: upload.size,
      problem: upload.phase === 'failed' ? upload.problem : null,
    });
  }
  result.push(...server);
  if (now !== null) {
    const known = new Set(rows.flatMap((row) => (row.upload === undefined ? [] : [row.upload.id])));
    const liveIds = new Set(live.flatMap((upload) => (upload.uploadId === null ? [] : [upload.uploadId])));
    // One row per upload, however many entries this browser kept for it; Dispensar forgets them all by its id.
    const shownIds = new Set<string>();
    for (const entry of stored) {
      const old = !Number.isNaN(entry.createdAt) && now - entry.createdAt > UPLOAD_LIFETIME_MS;
      const hidden = dismissed.has(entry.storageKey) || dismissed.has(entry.uploadId) || shownIds.has(entry.uploadId);
      if (old && !known.has(entry.uploadId) && !liveIds.has(entry.uploadId) && !hidden) {
        shownIds.add(entry.uploadId);
        result.push({ kind: 'gone', key: entry.storageKey, materialId: null, name: entry.name, dismissKeys: [entry.storageKey, entry.uploadId] });
      }
    }
  }
  return result;
}

const noSubscription = () => () => undefined;

/** True once the page runs in the browser (false while it renders on the server and hydrates). */
function useInBrowser(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

/** The clock, to the last {@link CLOCK_STEP_MS}; null while rendering on the server, so both renders agree. */
const CLOCK_STEP_MS = 15_000;

function useClock(): number | null {
  return useSyncExternalStore(
    (onChange) => {
      const timer = setInterval(onChange, CLOCK_STEP_MS);
      return () => clearInterval(timer);
    },
    () => Math.floor(Date.now() / CLOCK_STEP_MS) * CLOCK_STEP_MS,
    () => null,
  );
}

/**
 * The upload tray (Story 1.14), just above "Adicionar Arquivo": uploads and ingestions in progress, each with its
 * name (a link to its page once it has one), its state pill and a 2px line: of bytes sent while uploading, of pages
 * done while processing ("processando · 0 de 320 páginas", Story 1.15). Its server rows come from the signed-in layout;
 * while a row is uploading, waiting or processing and the tab is visible, it asks the router for fresh ones every 5 s
 * (`router.refresh()`: an RSC fetch, which never renews the session).
 */
export function UploadTray({ rows }: { readonly rows: readonly Material[] }) {
  const { texts, live, stored, dismissed } = useUploads();
  const inBrowser = useInBrowser();
  const now = useClock();

  const shown = trayRows(rows, live, stored, dismissed, inBrowser ? now : null);
  const moving = shown.some((row) => row.kind !== 'gone' && (row.kind === 'interrupted' || MOVING_STATES.includes(row.state)));
  useRefreshWhileMoving(moving);

  if (shown.length === 0) {
    return null;
  }
  return (
    <section className={styles.tray} aria-label={texts.upload.tray.label}>
      <h2 className={styles.trayLabel}>{texts.upload.tray.label}</h2>
      <ul className={styles.rows}>
        {shown.map((row) => (
          <TrayItem key={row.key} row={row} texts={texts} inBrowser={inBrowser} />
        ))}
      </ul>
    </section>
  );
}

function TrayItem({ row, texts, inBrowser }: { readonly row: TrayRow; readonly texts: UploadTexts; readonly inBrowser: boolean }) {
  const t = texts.upload.tray;
  const { resume, dismiss } = useUploads();
  const input = useRef<HTMLInputElement>(null);
  const [wrong, setWrong] = useState(false);
  const state: MaterialState = row.kind === 'interrupted' ? 'uploading' : row.kind === 'gone' ? 'failed' : row.state;
  const sent = row.kind === 'gone' ? 0 : row.sent;
  const total = row.kind === 'gone' ? 1 : Math.max(row.total, 1);
  const percent = Math.floor((sent / total) * 100);

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined || row.kind !== 'interrupted') {
      return;
    }
    // The same file: its name and its size. Anything else is refused here, and no upload is created.
    if (file.name.trim() !== row.name || file.size !== row.total) {
      setWrong(true);
      return;
    }
    setWrong(false);
    resume(row.uploadId, file);
  }

  return (
    <li className={styles.row}>
      <div className={styles.rowHead}>
        {row.materialId === null ? (
          <span className={styles.name}>{row.name}</span>
        ) : (
          <Link className={styles.name} href={`/files/${row.materialId}`}>
            {row.name}
          </Link>
        )}
        <StatePill state={state} word={texts.states[state]} detail={pagesDetail(row, state, texts)} />
      </div>
      <progress
        className={styles.line}
        value={sent}
        max={total}
        aria-label={fill(t.sent, { percent })}
        aria-hidden={state === 'uploading' ? undefined : true}
      />
      {row.kind === 'interrupted' ? (
        <>
          <p className={styles.note}>
            {t.interrupted}
            {inBrowser ? ` ${fill(t.expires, { time: expiryTime(row.expiresAt, texts.language) })}` : null}
          </p>
          {row.problem === null ? null : <p className={styles.note}>{problemText(row.problem, texts.errors)}</p>}
          {wrong ? (
            <p className={styles.note} role="alert">
              {fill(t.wrongFile, { name: row.name, size: formatSize(row.total, texts.language) })}
            </p>
          ) : null}
          <div className={styles.actions}>
            <input ref={input} type="file" hidden onChange={onFile} data-testid={`resume-${row.uploadId}`} />
            <PillButton aria-label={fill(t.resumeName, { name: row.name })} onClick={() => input.current?.click()}>
              {t.resume}
            </PillButton>
          </div>
        </>
      ) : null}
      {row.kind === 'gone' ? (
        <>
          <p className={styles.note}>{t.gone}</p>
          <div className={styles.actions}>
            <PillButton aria-label={fill(t.dismissName, { name: row.name })} onClick={() => dismiss(...row.dismissKeys)}>
              {t.dismiss}
            </PillButton>
          </div>
        </>
      ) : null}
      {row.kind === 'live' && row.state === 'failed' ? (
        <>
          <p className={styles.note}>{problemText(row.problem, texts.errors)}</p>
          <div className={styles.actions}>
            <PillButton aria-label={fill(t.dismissName, { name: row.name })} onClick={() => dismiss(row.key)}>
              {t.dismiss}
            </PillButton>
          </div>
        </>
      ) : null}
    </li>
  );
}

/** "0 de 320 páginas" beside a processing material whose page total is known; nothing otherwise. */
function pagesDetail(row: TrayRow, state: MaterialState, texts: UploadTexts): string | undefined {
  if (row.kind !== 'material' || row.pages === undefined || state !== 'processing') {
    return undefined;
  }
  return fill(texts.pages, { done: row.pages.done, total: row.pages.total });
}

/** The expiry as the GM reads it: the time, with the day when it is not today. */
function expiryTime(expiresAt: string, language: UploadTexts['language']): string {
  const date = new Date(expiresAt);
  const today = new Date().toDateString() === date.toDateString();
  return new Intl.DateTimeFormat(language, today ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}
