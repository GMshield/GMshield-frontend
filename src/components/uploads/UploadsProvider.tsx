'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { defaultOptions, type UrlStorage } from 'tus-js-client';

import { startUpload, UPLOADS_ENDPOINT, type UploadFile, type UploadHandle } from '@/client/upload';

import { fill, problemText, uploadIdOf, type Answers, type Belonging, type UploadTexts } from './types';
import styles from './Uploads.module.css';

/** How long an unfinished upload lives on the server: a stored resume entry older than this is gone. */
export const UPLOAD_LIFETIME_MS = 6 * 60 * 60 * 1000;

export type LivePhase = 'queued' | 'uploading' | 'waiting' | 'failed';

/** An upload this tab started or resumed. Lost on reload; the server's rows and the stored entries remain. */
export type LiveUpload = {
  readonly key: string;
  /** The sending it belongs to: one dialog's files. */
  readonly batch: number;
  readonly name: string;
  readonly size: number;
  readonly sent: number;
  readonly phase: LivePhase;
  /** Known once the server has created (or found) the upload. */
  readonly uploadId: string | null;
  /** Known once the server has verified the whole file. */
  readonly materialId: string | null;
  readonly problem: unknown;
};

/** A resume entry this browser keeps (tus-js-client's URL storage), as the tray reads it. */
export type StoredUpload = {
  readonly storageKey: string;
  readonly uploadId: string;
  readonly name: string;
  /** Milliseconds since the epoch; NaN when unknown. */
  readonly createdAt: number;
};

type Queued = { readonly key: string; readonly file: UploadFile; readonly metadata: Record<string, string>; readonly resumeUrl?: string };

export type Uploads = {
  readonly texts: UploadTexts;
  readonly belonging: Belonging;
  readonly live: readonly LiveUpload[];
  readonly stored: readonly StoredUpload[];
  /** Material ids and stored keys the GM dismissed in this tab. */
  readonly dismissed: ReadonlySet<string>;
  /** Queues `files` with the same answers: each becomes a material, uploaded one after another. Returns the sending. */
  send(files: readonly UploadFile[], answers: Answers): number;
  /** Goes on with an upload the server has, from its offset: never a new upload. */
  resume(uploadId: string, file: UploadFile): void;
  /**
   * Hides rows: a live upload by its key, a material by its id; a stored entry by its storage key or its upload's id
   * is also forgotten.
   */
  dismiss(...keys: readonly string[]): void;
  /** Says `text` through the live region: politely, or at once. */
  announce(text: string, urgent?: boolean): void;
};

const UploadsContext = createContext<Uploads | null>(null);

export function useUploads(): Uploads {
  const value = useContext(UploadsContext);
  if (value === null) {
    throw new Error('useUploads outside UploadsProvider');
  }
  return value;
}

export type UploadsProviderProps = {
  readonly texts: UploadTexts;
  readonly belonging: Belonging;
  /** For tests: tus-js-client's storage of resume entries (the browser's `localStorage` by default). */
  readonly urlStorage?: UrlStorage;
  /** For tests: the relay's address. */
  readonly endpoint?: string;
  readonly children: ReactNode;
};

/** The metadata of one sending: the answers, with the campaign's or the system's id. */
export function metadataFor(answers: Answers, belonging: Belonging): Record<string, string> {
  const metadata: Record<string, string> = { kind: answers.kind, language: answers.language };
  if (belonging !== null && answers.belonging === 'campaign') {
    metadata.campaign = belonging.campaign.id;
  } else if (belonging !== null && answers.belonging === 'system') {
    metadata.system = belonging.system.id;
  }
  return metadata;
}

async function readStored(storage: UrlStorage): Promise<StoredUpload[]> {
  const entries = await storage.findAllUploads();
  return entries.flatMap((entry) => {
    const url = typeof entry.uploadUrl === 'string' ? entry.uploadUrl : null;
    if (url === null || typeof entry.urlStorageKey !== 'string') {
      return [];
    }
    const filename = (entry.metadata as Record<string, unknown> | undefined)?.filename;
    return [
      {
        storageKey: entry.urlStorageKey,
        uploadId: uploadIdOf(url),
        name: typeof filename === 'string' ? filename : '',
        createdAt: Date.parse(String(entry.creationTime)),
      },
    ];
  });
}

/**
 * The uploads of this tab (Story 1.14), in the signed-in layout's shell, so they go on while the GM moves inside the
 * app; a reload loses them (the tray then offers "Retomar"). Files go one after another. Each state change and every
 * 10 % is announced politely; a refusal at once. A new upload and a finished one ask the router for fresh server rows
 * (`router.refresh()`, which renews no session).
 */
export function UploadsProvider({ texts, belonging, urlStorage, endpoint, children }: UploadsProviderProps) {
  const router = useRouter();
  const storage = urlStorage ?? defaultOptions.urlStorage;
  const [live, setLive] = useState<readonly LiveUpload[]>([]);
  const [stored, setStored] = useState<readonly StoredUpload[]>([]);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [polite, setPolite] = useState('');
  const [urgent, setUrgent] = useState('');
  const queue = useRef<Queued[]>([]);
  const running = useRef(false);
  const handles = useRef(new Map<string, UploadHandle>());
  const counter = useRef(0);
  const textsRef = useRef(texts);
  useEffect(() => {
    textsRef.current = texts;
  }, [texts]);

  const announce = useCallback((text: string, now = false) => {
    // A zero-width space alternates so that the same words are said again.
    const say = (previous: string) => (previous === text ? `${text}​` : text);
    if (now) {
      setUrgent(say);
    } else {
      setPolite(say);
    }
  }, []);

  const change = useCallback((key: string, update: (upload: LiveUpload) => LiveUpload) => {
    setLive((all) => all.map((upload) => (upload.key === key ? update(upload) : upload)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    readStored(storage).then(
      (entries) => {
        if (!cancelled) {
          setStored(entries);
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [storage]);

  const stateWords = useCallback((name: string, state: keyof UploadTexts['states']) => {
    const { upload, states } = textsRef.current;
    return fill(upload.tray.announce.state, { name, state: states[state] });
  }, []);

  const run = useCallback(
    async (item: Queued) => {
      const name = item.file.name;
      let decile = 0;
      change(item.key, (upload) => ({ ...upload, phase: 'uploading' }));
      announce(stateWords(name, 'uploading'));
      const handle = startUpload(item.file, {
        endpoint: endpoint ?? UPLOADS_ENDPOINT,
        metadata: item.metadata,
        urlStorage: storage,
        ...(item.resumeUrl === undefined ? {} : { resumeUrl: item.resumeUrl }),
        onUploadUrl: (url) => {
          change(item.key, (upload) => ({ ...upload, uploadId: uploadIdOf(url) }));
          router.refresh();
        },
        onProgress: (sent, total) => {
          change(item.key, (upload) => ({ ...upload, sent }));
          const reached = total > 0 ? Math.floor((sent / total) * 10) : 0;
          if (reached > decile && reached < 10) {
            decile = reached;
            announce(fill(textsRef.current.upload.tray.announce.percent, { name, percent: reached * 10 }));
          }
        },
      });
      handles.current.set(item.key, handle);
      try {
        const result = await handle.done;
        change(item.key, (upload) => ({ ...upload, phase: 'waiting', sent: upload.size, materialId: result.materialId }));
        announce(stateWords(name, 'waiting'));
      } catch (error) {
        // Without an answer to show (nothing reached GMshield, or the browser failed), the generic text applies.
        const problem = (error as { problem?: unknown }).problem ?? { category: 'server' };
        change(item.key, (upload) => ({ ...upload, phase: 'failed', problem }));
        // A refusal (the format, the size) is said at once; anything else politely.
        const refused = (problem as { status?: unknown } | null)?.status;
        const words = `${stateWords(name, 'failed')} ${problemText(problem, textsRef.current.errors)}`;
        announce(words, refused === 415 || refused === 413 || refused === 400);
      } finally {
        handles.current.delete(item.key);
        router.refresh();
      }
    },
    [announce, change, endpoint, router, stateWords, storage],
  );

  const pump = useCallback(async () => {
    if (running.current) {
      return;
    }
    running.current = true;
    try {
      for (let next = queue.current.shift(); next !== undefined; next = queue.current.shift()) {
        await run(next);
      }
    } finally {
      running.current = false;
    }
  }, [run]);

  const enqueue = useCallback(
    (file: UploadFile, batch: number, metadata: Record<string, string>, uploadId: string | null, resumeUrl?: string) => {
      counter.current += 1;
      const key = `live-${counter.current}`;
      setLive((all) => [
        { key, batch, name: file.name, size: file.size, sent: 0, phase: 'queued', uploadId, materialId: null, problem: null },
        ...all,
      ]);
      queue.current.push({ key, file, metadata, ...(resumeUrl === undefined ? {} : { resumeUrl }) });
    },
    [],
  );

  const send = useCallback(
    (files: readonly UploadFile[], answers: Answers) => {
      counter.current += 1;
      const batch = counter.current;
      const metadata = metadataFor(answers, belonging);
      for (const file of files) {
        enqueue(file, batch, metadata, null);
      }
      void pump();
      return batch;
    },
    [belonging, enqueue, pump],
  );

  const resume = useCallback(
    (uploadId: string, file: UploadFile) => {
      enqueue(file, 0, {}, uploadId, `${endpoint ?? UPLOADS_ENDPOINT}/${encodeURIComponent(uploadId)}`);
      void pump();
    },
    [endpoint, enqueue, pump],
  );

  const dismiss = useCallback(
    (...keys: readonly string[]) => {
      const gone = (upload: LiveUpload) => keys.includes(upload.key) && upload.phase !== 'uploading' && upload.phase !== 'queued';
      setLive((all) => all.filter((upload) => !gone(upload)));
      setDismissed((previous) => new Set([...previous, ...keys]));
      const forgotten = stored.filter((entry) => keys.includes(entry.storageKey) || keys.includes(entry.uploadId));
      for (const entry of forgotten) {
        storage.removeUpload(entry.storageKey).catch(() => undefined);
      }
    },
    [storage, stored],
  );

  // Leaving the signed-in shell (signing out) stops sending; the server keeps what it has for its 6 hours.
  useEffect(() => {
    const all = handles.current;
    return () => {
      for (const handle of all.values()) {
        handle.abort().catch(() => undefined);
      }
    };
  }, []);

  const value = useMemo<Uploads>(
    () => ({ texts, belonging, live, stored, dismissed, send, resume, dismiss, announce }),
    [texts, belonging, live, stored, dismissed, send, resume, dismiss, announce],
  );

  return (
    <UploadsContext.Provider value={value}>
      {children}
      <div className={styles.visuallyHidden} aria-live="polite" data-testid="uploads-polite">
        {polite}
      </div>
      <div className={styles.visuallyHidden} aria-live="assertive" data-testid="uploads-urgent">
        {urgent}
      </div>
    </UploadsContext.Provider>
  );
}
