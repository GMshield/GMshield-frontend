'use client';

import Link from 'next/link';
import { useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react';

import { checkFile } from '@/client/upload/sniff';

import { PillButton } from '../PillButton';
import { StatePill } from '../StatePill';
import { useRefreshWhileMoving } from '../useRefreshWhileMoving';

import {
  fill,
  formatSize,
  isImageFormat,
  MOVING_STATES,
  problemText,
  progressOf,
  type Material,
  type MaterialPages,
  type MaterialState,
  type SetImageRow,
  type UploadTexts,
} from './types';
import styles from './Uploads.module.css';
import { UPLOAD_LIFETIME_MS, useUploads, type LiveUpload, type SetTarget, type StoredUpload } from './UploadsProvider';

/** How often the tray asks for fresh rows while one of them is moving and the tab is visible. */
export { REFRESH_MS } from '../useRefreshWhileMoving';

/** One row of the tray, from the server, from this tab, or from a stored resume entry. */
export type TrayRow =
  | { readonly kind: 'material'; readonly key: string; readonly materialId: string; readonly name: string; readonly state: MaterialState; readonly sent: number; readonly total: number; readonly pages?: MaterialPages }
  | { readonly kind: 'live'; readonly key: string; readonly materialId: string | null; readonly name: string; readonly state: MaterialState; readonly sent: number; readonly total: number; readonly problem: unknown }
  | { readonly kind: 'interrupted'; readonly key: string; readonly materialId: string; readonly name: string; readonly uploadId: string; readonly sent: number; readonly total: number; readonly expiresAt: string; readonly problem: unknown }
  | { readonly kind: 'gone'; readonly key: string; readonly materialId: string | null; readonly name: string; readonly dismissKeys: readonly string[] }
  | {
      readonly kind: 'set';
      readonly key: string;
      readonly materialId: string;
      readonly name: string;
      readonly setId: string;
      readonly state: MaterialState;
      readonly sent: number;
      readonly total: number;
      /** Whether one of its images is being sent from this tab now. */
      readonly sending: boolean;
      readonly images: readonly TraySetImage[];
    };

/**
 * An image of a set still uploading (Story 1.21), from the server's row and this tab's live upload of it: `failed`
 * with its reason (the server's code, or this tab's problem before the server's rows catch up), `open` while it waits
 * for its bytes (`live` when this tab is sending it), `complete` once verified.
 */
export type TraySetImage = {
  readonly position: number;
  readonly uploadId: string;
  readonly name: string;
  readonly state: 'open' | 'complete' | 'failed';
  readonly live: boolean;
  readonly length: number;
  readonly problem: unknown;
  /** This tab's failure to send an open image that the backend did not record (a network or server error). */
  readonly note: unknown;
};

/** The refusals the backend also records on the image's row (format, whole-file check, expiry). */
const RECORDED = new Set([410, 415, 422]);
const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp,.tif,.tiff,.bmp,.heic,.heif,image/*';

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
    if (row.state === 'uploading' && row.imageSet !== undefined) {
      server.push(setRow(row, row.imageSet, mine));
    } else if (newest !== undefined && ACTIVE.has(newest.phase)) {
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
      // Pages fill the line only while processing, with the pill's measure (Story 1.17); any other state keeps a full line.
      const progress = row.pages === undefined || row.state !== 'processing' ? null : progressOf(row.pages);
      server.push(
        progress === null || row.pages === undefined
          ? { kind: 'material', key: row.id, materialId: row.id, name: row.name, state: row.state, sent: 1, total: 1 }
          : { kind: 'material', key: row.id, materialId: row.id, name: row.name, state: row.state, sent: progress.done, total: progress.total, pages: row.pages },
      );
    }
  }
  // A set's images this tab sends before the server's rows show the set: one row for the set.
  const sets = new Map<string, LiveUpload[]>();
  for (const upload of live) {
    if (matched.has(upload.key) || dismissed.has(upload.key)) {
      continue;
    }
    if (upload.set !== null) {
      sets.set(upload.set.key, [...(sets.get(upload.set.key) ?? []), upload]);
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
  for (const [key, members] of sets) {
    const first = members[0];
    if (first === undefined || dismissed.has(key)) {
      continue;
    }
    const failed = members.find((upload) => upload.phase === 'failed');
    const active = members.some((upload) => ACTIVE.has(upload.phase));
    const state: MaterialState = active ? 'uploading' : failed !== undefined ? 'failed' : 'waiting';
    result.push({
      kind: 'live',
      key,
      materialId: first.materialId,
      name: first.set?.name ?? first.name,
      state,
      sent: members.reduce((sum, upload) => sum + (upload.phase === 'waiting' ? upload.size : upload.sent), 0),
      total: members.reduce((sum, upload) => sum + upload.size, 0),
      problem: state === 'failed' ? (failed?.problem ?? null) : null,
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

/**
 * A set still uploading (Story 1.21): its images from the server, each overlaid with this tab's live upload of it
 * (the newest first), and its bytes in all.
 */
function setRow(row: Material, set: NonNullable<Material['imageSet']>, mine: readonly LiveUpload[]): TrayRow {
  const images = set.images.map((image: SetImageRow): TraySetImage & { readonly sent: number } => {
    const upload = mine.find((candidate) => candidate.uploadId === image.uploadId);
    const sending = upload !== undefined && ACTIVE.has(upload.phase);
    // Failed only when the backend says so, or answered a refusal it records too: otherwise the image is still open
    // there, and can be resumed.
    const liveFailedOpen = upload?.phase === 'failed' && image.state === 'open';
    const status = (upload?.problem as { status?: unknown } | null | undefined)?.status;
    const liveFailed = liveFailedOpen && typeof status === 'number' && RECORDED.has(status);
    const state = image.state === 'failed' || liveFailed ? 'failed' : image.state;
    return {
      position: image.position,
      uploadId: image.uploadId,
      name: image.name ?? upload?.name ?? '',
      state,
      live: sending,
      length: image.length,
      problem: image.failure !== undefined ? { category: 'upload', code: image.failure } : liveFailed ? upload.problem : null,
      note: liveFailedOpen && !liveFailed ? upload.problem : null,
      sent: image.state === 'complete' || upload?.phase === 'waiting' ? image.length : sending ? upload.sent : image.offset,
    };
  });
  return {
    kind: 'set',
    key: row.id,
    materialId: row.id,
    name: row.name,
    setId: set.id,
    state: row.state,
    sent: images.reduce((sum, image) => sum + image.sent, 0),
    total: images.reduce((sum, image) => sum + image.length, 0),
    sending: images.some((image) => image.live),
    images: images.map((image) => ({
      position: image.position,
      uploadId: image.uploadId,
      name: image.name,
      state: image.state,
      live: image.live,
      length: image.length,
      problem: image.problem,
      note: image.note,
    })),
  };
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
 * name (a link to its page once it has one), its state pill and a 2px line: of bytes sent while uploading ("enviando ·
 * 45%", a solid line), of pages done while processing ("processando · 0 de 320 páginas", Story 1.15), and since Story
 * 1.17 of the pages being read, named ("lendo texto · 40 de 364 páginas", "lendo por OCR · 12 de 80 páginas"), on a
 * dashed line (`data-phase="processing"`), so the end of the upload never looks like it starting over. Its server rows come from the signed-in layout;
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
  // Never under 0 or over 100, whatever the server and the browser each count.
  const percent = Math.min(Math.max(Math.floor((sent / total) * 100), 0), 100);
  const pill = pillOf(row, state, percent, texts);

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
        <StatePill state={state} word={pill.word} detail={pill.detail} />
      </div>
      <progress
        className={styles.line}
        value={sent}
        max={total}
        aria-label={fill(t.sent, { percent })}
        aria-hidden={state === 'uploading' ? undefined : true}
        data-phase={state === 'processing' ? 'processing' : state === 'uploading' ? 'upload' : undefined}
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
      {row.kind === 'set' ? <SetImages row={row} texts={texts} /> : null}
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

/**
 * The pill's word and its measure: "enviando · 45%" for a live upload; for a processing material whose page total is
 * known, what is being read and how far ("lendo texto · 40 de 364 páginas", "lendo por OCR · 12 de 80 páginas",
 * "processando · 3 de 3 páginas"); the state's word alone otherwise.
 */
export function pillOf(row: TrayRow, state: MaterialState, percent: number, texts: UploadTexts): { readonly word: string; readonly detail?: string } {
  if ((row.kind === 'live' || (row.kind === 'set' && row.sending)) && state === 'uploading') {
    return { word: texts.states.uploading, detail: fill(texts.percent, { percent }) };
  }
  if (row.kind !== 'material' || row.pages === undefined || state !== 'processing') {
    return { word: texts.states[state] };
  }
  const progress = progressOf(row.pages);
  return {
    word: progress.phase === null ? texts.states.processing : texts.phases[progress.phase],
    detail: fill(texts.pages, { done: progress.done, total: progress.total }),
  };
}

/**
 * A set's images that need the GM (Story 1.21): each failed one, named with its place and reason, with "Substituir"
 * (another image for that place, checked here first) and "Continuar sem ela"; then, when images are still missing and
 * this tab is not sending them, "Retomar as fotos", which asks for those files (each matched by its name and size).
 */
function SetImages({ row, texts }: { readonly row: Extract<TrayRow, { kind: 'set' }>; readonly texts: UploadTexts }) {
  const t = texts.upload.tray;
  const { resume } = useUploads();
  const input = useRef<HTMLInputElement>(null);
  const [wrong, setWrong] = useState<string | null>(null);
  const failed = row.images.filter((image) => image.state === 'failed');
  const missing = row.images.filter((image) => image.state === 'open' && !image.live);
  const target = (image: TraySetImage): SetTarget => ({ setId: row.setId, materialId: row.materialId, setName: row.name, position: image.position });

  function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    let resumed = 0;
    // Each chosen file fills one place only, even when two missing images have the same name and size.
    const used = new Set<File>();
    for (const image of missing) {
      const file = files.find((candidate) => !used.has(candidate) && candidate.name.trim() === image.name && candidate.size === image.length);
      if (file !== undefined) {
        used.add(file);
        resume(image.uploadId, file, target(image));
        resumed++;
      }
    }
    setWrong(resumed === 0 ? fill(t.wrongImages, { names: missing.map((image) => image.name).join(', ') }) : null);
  }

  return (
    <>
      {failed.map((image) => (
        <FailedImage key={image.uploadId} image={image} target={target(image)} texts={texts} />
      ))}
      {missing.length > 0 && !row.sending ? (
        <>
          <p className={styles.note}>{fill(t.setInterrupted, { count: missing.length, total: row.images.length })}</p>
          {missing
            .filter((image) => image.note !== null)
            .map((image) => (
              <p key={image.uploadId} className={styles.note}>
                {fill(t.setFailed, { position: image.position, name: image.name, reason: problemText(image.note, texts.errors) })}
              </p>
            ))}
          {wrong === null ? null : (
            <p className={styles.note} role="alert">
              {wrong}
            </p>
          )}
          <div className={styles.actions}>
            <input ref={input} type="file" multiple hidden accept={IMAGE_ACCEPT} onChange={onFiles} data-testid={`resume-set-${row.setId}`} />
            <PillButton aria-label={fill(t.resumeSetName, { name: row.name })} onClick={() => input.current?.click()}>
              {t.resumeSet}
            </PillButton>
          </div>
        </>
      ) : null}
    </>
  );
}

function FailedImage({ image, target, texts }: { readonly image: TraySetImage; readonly target: SetTarget; readonly texts: UploadTexts }) {
  const t = texts.upload.tray;
  const { replaceImage, dropImage } = useUploads();
  const input = useRef<HTMLInputElement>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) {
      return;
    }
    // Only an image goes to a set's place: anything else is refused here, and no upload is created.
    const check = await checkFile(file);
    if (!check.ok || !isImageFormat(check.format)) {
      setRefusal(fill(t.notImage, { name: file.name }));
      return;
    }
    setRefusal(null);
    const problem = await replaceImage(target, file);
    setRefusal(problem === null ? null : problemText(problem, texts.errors));
  }

  async function onSkip() {
    setBusy(true);
    const problem = await dropImage(target);
    setBusy(false);
    setRefusal(problem === null ? null : problemText(problem, texts.errors));
  }

  return (
    <>
      <p className={styles.note}>{fill(t.setFailed, { position: image.position, name: image.name, reason: problemText(image.problem, texts.errors) })}</p>
      {refusal === null ? null : (
        <p className={styles.note} role="alert">
          {refusal}
        </p>
      )}
      <div className={styles.actions}>
        <input
          ref={input}
          type="file"
          hidden
          accept={IMAGE_ACCEPT}
          onChange={(event) => void onFile(event)}
          data-testid={`replace-${image.uploadId}`}
        />
        <PillButton aria-label={fill(t.replaceName, { position: image.position, name: image.name })} onClick={() => input.current?.click()}>
          {t.replace}
        </PillButton>
        <PillButton aria-label={fill(t.skipName, { position: image.position, name: image.name })} disabled={busy} onClick={() => void onSkip()}>
          {t.skip}
        </PillButton>
      </div>
    </>
  );
}

/** The expiry as the GM reads it: the time, with the day when it is not today. */
function expiryTime(expiresAt: string, language: UploadTexts['language']): string {
  const date = new Date(expiresAt);
  const today = new Date().toDateString() === date.toDateString();
  return new Intl.DateTimeFormat(language, today ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}
