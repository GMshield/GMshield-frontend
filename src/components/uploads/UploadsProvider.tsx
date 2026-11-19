'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { defaultOptions, type UrlStorage } from 'tus-js-client';

import { startUpload, UPLOADS_ENDPOINT, type UploadFile, type UploadHandle } from '@/client/upload';

import {
  fill,
  problemText,
  uploadIdOf,
  type Answers,
  type Belonging,
  type ImageSetCalls,
  type SendPlan,
  type SetCallResult,
  type SetProblem,
  type UploadTexts,
} from './types';
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
  /** Known once the server has verified the whole file; for an image of a set, once the set is created. */
  readonly materialId: string | null;
  readonly problem: unknown;
  /**
   * Story 1.21: the image set this upload is an image of: its key in this tab and its name, then its id and the
   * image's place once the backend has created it. Null for a file that is a material of its own.
   */
  readonly set: LiveSet | null;
};

export type LiveSet = { readonly key: string; readonly name: string; readonly id: string | null; readonly position: number };

/** An image of a set the tray acts on (Story 1.21): the set, its material and name, and the image's place. */
export type SetTarget = { readonly setId: string; readonly materialId: string; readonly setName: string; readonly position: number };

/** A resume entry this browser keeps (tus-js-client's URL storage), as the tray reads it. */
export type StoredUpload = {
  readonly storageKey: string;
  readonly uploadId: string;
  readonly name: string;
  /** Milliseconds since the epoch; NaN when unknown. */
  readonly createdAt: number;
};

type QueuedFile = {
  readonly kind: 'file';
  readonly key: string;
  readonly file: UploadFile;
  readonly metadata: Record<string, string>;
  readonly resumeUrl?: string;
};
/** Story 1.21: a set to create, then its images to send one after another, each at its upload's address. */
type QueuedSet = {
  readonly kind: 'set';
  readonly key: string;
  readonly name: string;
  readonly answers: Answers;
  readonly members: readonly { readonly key: string; readonly file: UploadFile }[];
};
/** Story 1.21: a failed image's new upload to ask for, then to send. */
type QueuedReplacement = {
  readonly kind: 'replace';
  readonly key: string;
  readonly file: UploadFile;
  readonly target: SetTarget;
  /** Told the backend's answer to the new upload: its refusal, or null. */
  readonly answered: (problem: SetProblem | null) => void;
};
type Queued = QueuedFile | QueuedSet | QueuedReplacement;

export type Uploads = {
  readonly texts: UploadTexts;
  readonly belonging: Belonging;
  readonly live: readonly LiveUpload[];
  readonly stored: readonly StoredUpload[];
  /** Material ids and stored keys the GM dismissed in this tab. */
  readonly dismissed: ReadonlySet<string>;
  /**
   * Queues one sending with the same answers, uploaded one after another: each file becomes a material, and each set
   * (Story 1.21) one material whose pages are its images, in their order. Returns the sending.
   */
  send(plan: SendPlan, answers: Answers): number;
  /** Goes on with an upload the server has, from its offset: never a new upload. `member` names an image's set. */
  resume(uploadId: string, file: UploadFile, member?: SetTarget): void;
  /**
   * Story 1.21: a new upload for a failed image of a set, at its place, then the file sent to it. Answers, once the
   * backend has answered the new upload, its refusal (for the row to show), or null.
   */
  replaceImage(target: SetTarget, file: UploadFile): Promise<SetProblem | null>;
  /** Story 1.21: the set goes on without its failed image; answers the refusal, or null. */
  dropImage(target: SetTarget): Promise<SetProblem | null>;
  /**
   * Hides rows: a live upload by its key, a material by its id; a stored entry by its storage key or its upload's id
   * is also forgotten.
   */
  dismiss(...keys: readonly string[]): void;
  /** Says `text` through the live region: politely, or at once. */
  announce(text: string, urgent?: boolean): void;
  /** Story 2.4: whether the guided upload is open; the sidebar's control and the conversation's empty state open it. */
  readonly uploadOpen: boolean;
  /** Opens the guided upload (Story 2.4: from the conversation's empty state too). */
  openUpload(): void;
  closeUpload(): void;
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
  /** The set calls (Story 1.21): the Server Actions, given by the shell. */
  readonly imageSets?: ImageSetCalls;
  readonly children: ReactNode;
};

const NO_SETS: ImageSetCalls = {
  create: () => Promise.resolve(unavailable()),
  replace: () => Promise.resolve(unavailable()),
  drop: () => Promise.resolve(unavailable()),
};

/** The problem of a set call that could not be made or threw (the network, the server). */
function thrown(): SetProblem {
  return { status: 503, category: 'server', code: 'server.unavailable', params: {} };
}

function unavailable(): SetCallResult<never> {
  return { ok: false, problem: thrown() };
}

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

/** Where a set belongs: the current campaign or its system, as the dialog's answer says (Story 1.21). */
function setPlace(answers: Answers, belonging: Belonging): { campaign?: string; system?: string } {
  if (belonging !== null && answers.belonging === 'campaign') {
    return { campaign: belonging.campaign.id };
  }
  if (belonging !== null && answers.belonging === 'system') {
    return { system: belonging.system.id };
  }
  return {};
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
 *
 * Story 1.21: an image set is created first (its order confirmed), then its images go one after another, each through
 * tus at the address its upload was given (`resumeUrl`, so no other upload is ever created). The set is announced as
 * one: when it starts sending and when its last image is verified; an image that fails is announced at once, and the
 * set waits in the tray for the GM to replace it or go on without it.
 */
export function UploadsProvider({ texts, belonging, urlStorage, endpoint, imageSets = NO_SETS, children }: UploadsProviderProps) {
  const router = useRouter();
  const storage = urlStorage ?? defaultOptions.urlStorage;
  const [live, setLive] = useState<readonly LiveUpload[]>([]);
  const [stored, setStored] = useState<readonly StoredUpload[]>([]);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [polite, setPolite] = useState('');
  const [urgent, setUrgent] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const openUpload = useCallback(() => setUploadOpen(true), []);
  const closeUpload = useCallback(() => setUploadOpen(false), []);
  const queue = useRef<Queued[]>([]);
  const running = useRef(false);
  const stopped = useRef(false);
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

  const failWith = useCallback(
    (key: string, name: string, problem: unknown) => {
      change(key, (upload) => ({ ...upload, phase: 'failed', problem }));
      // A refusal (the format, the size) is said at once; anything else politely.
      const refused = (problem as { status?: unknown } | null)?.status;
      const words = `${stateWords(name, 'failed')} ${problemText(problem, textsRef.current.errors)}`;
      announce(words, refused === 415 || refused === 413 || refused === 400 || refused === 422);
    },
    [announce, change, stateWords],
  );

  /**
   * One file through tus: a new upload, or (`resumeUrl`) one the server already has. Answers the version's state once
   * the file is verified, or null when it failed. An image of a set (`quiet`) announces only its failure: its set is
   * announced as one.
   */
  const sendFile = useCallback(
    async (key: string, file: UploadFile, options: { metadata: Record<string, string>; resumeUrl?: string; quiet?: boolean }) => {
      const name = file.name;
      let decile = 0;
      change(key, (upload) => ({ ...upload, phase: 'uploading' }));
      if (options.quiet !== true) {
        announce(stateWords(name, 'uploading'));
      }
      const handle = startUpload(file, {
        endpoint: endpoint ?? UPLOADS_ENDPOINT,
        metadata: options.metadata,
        urlStorage: storage,
        ...(options.resumeUrl === undefined ? {} : { resumeUrl: options.resumeUrl }),
        onUploadUrl: (url) => {
          change(key, (upload) => ({ ...upload, uploadId: uploadIdOf(url) }));
          router.refresh();
        },
        onProgress: (sent, total) => {
          change(key, (upload) => ({ ...upload, sent }));
          const reached = total > 0 ? Math.floor((sent / total) * 10) : 0;
          if (options.quiet !== true && reached > decile && reached < 10) {
            decile = reached;
            announce(fill(textsRef.current.upload.tray.announce.percent, { name, percent: reached * 10 }));
          }
        },
      });
      handles.current.set(key, handle);
      try {
        const result = await handle.done;
        change(key, (upload) => ({ ...upload, phase: 'waiting', sent: upload.size, materialId: result.materialId }));
        if (options.quiet !== true) {
          announce(stateWords(name, 'waiting'));
        }
        return result.state;
      } catch (error) {
        // Without an answer to show (nothing reached GMshield, or the browser failed), the generic text applies.
        failWith(key, name, (error as { problem?: unknown }).problem ?? { category: 'server' });
        return null;
      } finally {
        handles.current.delete(key);
        router.refresh();
      }
    },
    [announce, change, endpoint, failWith, router, stateWords, storage],
  );

  const addressOf = useCallback((uploadId: string) => `${endpoint ?? UPLOADS_ENDPOINT}/${encodeURIComponent(uploadId)}`, [endpoint]);

  /** Story 1.21: the set is created with its order, then its images are sent in that order. */
  const sendSet = useCallback(
    async (item: QueuedSet) => {
      announce(stateWords(item.name, 'uploading'));
      let created: Awaited<ReturnType<ImageSetCalls['create']>>;
      try {
        created = await imageSets.create({
          name: item.name,
          kind: item.answers.kind,
          language: item.answers.language,
          ...setPlace(item.answers, belonging),
          images: item.members.map(({ file }) => ({ name: file.name, length: file.size })),
        });
      } catch {
        created = { ok: false, problem: thrown() };
      }
      if (!created.ok) {
        const { problem } = created;
        for (const member of item.members) {
          change(member.key, (upload) => ({ ...upload, phase: 'failed', problem }));
        }
        failWith(item.members[0]?.key ?? item.key, item.name, problem);
        return;
      }
      const { id, materialId, images } = created.data;
      if (images.length !== item.members.length) {
        // Not the set that was asked for: none of its images is sent.
        const problem = thrown();
        for (const member of item.members) {
          change(member.key, (upload) => ({ ...upload, phase: 'failed', problem }));
        }
        failWith(item.members[0]?.key ?? item.key, item.name, problem);
        return;
      }
      item.members.forEach((member, index) => {
        const uploadId = images[index]?.uploadId ?? null;
        change(member.key, (upload) => ({
          ...upload,
          uploadId,
          materialId,
          set: { key: item.key, name: item.name, id, position: index + 1 },
        }));
      });
      router.refresh();
      let state: string | null = null;
      for (const [index, member] of item.members.entries()) {
        const uploadId = images[index]?.uploadId;
        if (uploadId === undefined || stopped.current) {
          break;
        }
        state = (await sendFile(member.key, member.file, { metadata: {}, resumeUrl: addressOf(uploadId), quiet: true })) ?? state;
      }
      if (state === 'waiting') {
        announce(stateWords(item.name, 'waiting'));
      }
    },
    [addressOf, announce, belonging, change, failWith, imageSets, router, sendFile, stateWords],
  );

  /** Story 1.21: a failed image's new upload at its place, then the file sent to it. */
  const sendReplacement = useCallback(
    async (item: QueuedReplacement) => {
      const { target, file } = item;
      let replaced: Awaited<ReturnType<ImageSetCalls['replace']>>;
      try {
        replaced = await imageSets.replace(target.setId, target.position, { name: file.name, length: file.size });
      } catch {
        replaced = { ok: false, problem: thrown() };
      }
      if (!replaced.ok) {
        item.answered(replaced.problem);
        failWith(item.key, file.name, replaced.problem);
        router.refresh();
        return;
      }
      item.answered(null);
      change(item.key, (upload) => ({ ...upload, uploadId: replaced.data.uploadId }));
      const state = await sendFile(item.key, file, { metadata: {}, resumeUrl: addressOf(replaced.data.uploadId), quiet: true });
      if (state === 'waiting') {
        announce(stateWords(target.setName, 'waiting'));
      }
    },
    [addressOf, announce, change, failWith, imageSets, router, sendFile, stateWords],
  );

  const run = useCallback(
    async (item: Queued) => {
      if (item.kind === 'set') {
        await sendSet(item);
      } else if (item.kind === 'replace') {
        await sendReplacement(item);
      } else {
        await sendFile(item.key, item.file, { metadata: item.metadata, ...(item.resumeUrl === undefined ? {} : { resumeUrl: item.resumeUrl }) });
      }
    },
    [sendFile, sendReplacement, sendSet],
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

  /** A new live upload, newest first; its key. */
  const addLive = useCallback((file: UploadFile, batch: number, uploadId: string | null, materialId: string | null, set: LiveSet | null) => {
    counter.current += 1;
    const key = `live-${counter.current}`;
    const added: LiveUpload = { key, batch, name: file.name, size: file.size, sent: 0, phase: 'queued', uploadId, materialId, problem: null, set };
    setLive((all) => [added, ...all]);
    return key;
  }, []);

  const send = useCallback(
    (plan: SendPlan, answers: Answers) => {
      counter.current += 1;
      const batch = counter.current;
      const metadata = metadataFor(answers, belonging);
      for (const file of plan.files) {
        const key = addLive(file, batch, null, null, null);
        queue.current.push({ kind: 'file', key, file, metadata });
      }
      for (const set of plan.sets) {
        counter.current += 1;
        const setKey = `set-${counter.current}`;
        // Added last first, so the live list (newest first) shows them in their order.
        const members = [...set.files].reverse().map((file) => ({ key: addLive(file, batch, null, null, { key: setKey, name: set.name, id: null, position: 0 }), file })).reverse();
        queue.current.push({ kind: 'set', key: setKey, name: set.name, answers, members });
      }
      void pump();
      return batch;
    },
    [addLive, belonging, pump],
  );

  const resume = useCallback(
    (uploadId: string, file: UploadFile, member?: SetTarget) => {
      const set = member === undefined ? null : { key: `set-${member.setId}`, name: member.setName, id: member.setId, position: member.position };
      const key = addLive(file, 0, uploadId, member?.materialId ?? null, set);
      queue.current.push({ kind: 'file', key, file, metadata: {}, resumeUrl: addressOf(uploadId) });
      void pump();
    },
    [addLive, addressOf, pump],
  );

  const replaceImage = useCallback(
    (target: SetTarget, file: UploadFile) =>
      new Promise<SetProblem | null>((answered) => {
        const key = addLive(file, 0, null, target.materialId, { key: `set-${target.setId}`, name: target.setName, id: target.setId, position: target.position });
        queue.current.push({ kind: 'replace', key, file, target, answered });
        void pump();
      }),
    [addLive, pump],
  );

  const dropImage = useCallback(
    async (target: SetTarget) => {
      let dropped: Awaited<ReturnType<ImageSetCalls['drop']>>;
      try {
        dropped = await imageSets.drop(target.setId, target.position);
      } catch {
        dropped = { ok: false, problem: thrown() };
      }
      router.refresh();
      if (!dropped.ok) {
        announce(problemText(dropped.problem, textsRef.current.errors), true);
        return dropped.problem;
      }
      const state = dropped.data.state === 'discarded' ? 'failed' : dropped.data.state === 'waiting' ? 'waiting' : 'uploading';
      announce(stateWords(target.setName, state));
      return null;
    },
    [announce, imageSets, router, stateWords],
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
    const waiting = queue.current;
    const stop = stopped;
    stop.current = false;
    return () => {
      // Nothing queued starts once the shell is gone, not even a set's next image.
      stop.current = true;
      waiting.length = 0;
      for (const handle of all.values()) {
        handle.abort().catch(() => undefined);
      }
    };
  }, []);

  const value = useMemo<Uploads>(
    () => ({
      texts,
      belonging,
      live,
      stored,
      dismissed,
      send,
      resume,
      replaceImage,
      dropImage,
      dismiss,
      announce,
      uploadOpen,
      openUpload,
      closeUpload,
    }),
    [texts, belonging, live, stored, dismissed, send, resume, replaceImage, dropImage, dismiss, announce, uploadOpen, openUpload, closeUpload],
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
