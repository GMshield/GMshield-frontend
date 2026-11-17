import { DefaultHttpStack, Upload, defaultOptions, type DetailedError, type FileReader, type HttpStack, type UrlStorage } from 'tus-js-client';

import { ChecksumHttpStack } from './checksum-stack';
import { sha256OfFile } from './file-hash';

/**
 * The browser side of the resumable upload (Story 1.13, AD-16). It wraps tus-js-client against this site's own relay
 * (`/api/v1/uploads`, `src/app/api/v1/uploads`), never the backend:
 *
 * - parts of 64 MiB, each with `Upload-Checksum: sha256 …` of its own bytes ({@link ChecksumHttpStack});
 * - the upload URL is kept under the file's fingerprint (a SHA-256 that names nothing of the file), so a page opened
 *   again within the 6 hours finds it (`findPreviousUploads`), asks the server's offset and goes on from the last
 *   verified part (`resumeFromPreviousUpload`); nothing already stored is sent again, and an upload whose every byte
 *   is stored goes straight to its completion. The URL is forgotten only once the completion has answered 201;
 * - a failed part is retried after each of the `retryDelays` (a part whose checksum failed too);
 * - meanwhile the whole file's SHA-256 is computed slice by slice ({@link sha256OfFile}); once the last part is
 *   stored, `POST <upload>/completion` sends it, and the version moves to `waiting`.
 *
 * Story 1.14 puts the dialog and the tray on top of it, and adds {@link UploadOptions.resumeUrl}: "Retomar" in the tray
 * goes on with a known upload and never creates another one. Nothing here reads the file other than in slices.
 */
export const UPLOADS_ENDPOINT = '/api/v1/uploads';
/** The size of a part: under the tunnel's 100 MB request limit and the backend's 90 MiB. */
export const PART_BYTES = 64 * 1024 * 1024;
export const RETRY_DELAYS: readonly number[] = [0, 1_000, 3_000, 5_000, 10_000, 20_000, 30_000];
const TUS_VERSION = '1.0.0';
/** Statuses after which a request is tried again: a server's failure, a conflict or lock, a damaged part. */
const RETRIED_STATUSES = new Set([0, 409, 423, 460]);

/** A file to upload: a `File`, or any Blob with a name. */
export type UploadFile = Blob & { readonly name: string; readonly lastModified?: number };

/** A verified upload: the material and version the backend made, and the version's state (`waiting`). */
export type UploadResult = {
  readonly materialId: string;
  readonly versionId: string;
  readonly state: string;
  readonly uploadUrl: string;
};

/** A failed upload: the HTTP status (null when nothing answered) and the problem detail, for `errorText`. */
export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly problem: unknown,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

export type UploadOptions = {
  /** The relay; relative to the page unless absolute. Default {@link UPLOADS_ENDPOINT}. */
  readonly endpoint?: string;
  readonly partBytes?: number;
  readonly retryDelays?: readonly number[];
  /** Further tus metadata (Story 1.14); `filename` is always the file's name. */
  readonly metadata?: Readonly<Record<string, string>>;
  /**
   * Resume only (Story 1.14): the address of an upload the server already has, such as `/api/v1/uploads/<id>`. The
   * upload goes on from the server's offset; when the server no longer has it (404, 410), `done` rejects and no new
   * upload is created.
   */
  readonly resumeUrl?: string;
  /** Once the server has given the upload's address (created or resumed), absolute. */
  readonly onUploadUrl?: (uploadUrl: string) => void;
  readonly onProgress?: (bytesSent: number, bytesTotal: number) => void;
  /** After each part the server has verified and stored. */
  readonly onPartStored?: (bytesStored: number, bytesTotal: number) => void;
  /** The size of each slice of the whole-file hash; mostly for tests. */
  readonly hashSliceBytes?: number;
  /** The environment's own by default: XMLHttpRequest, the file's slices and `localStorage` in a browser. */
  readonly httpStack?: HttpStack;
  readonly fileReader?: FileReader;
  readonly urlStorage?: UrlStorage;
};

export type UploadHandle = {
  /** Settles once the server has verified the whole file, or with an {@link UploadError}. */
  readonly done: Promise<UploadResult>;
  /** Stops sending, and `done` rejects; the upload stays resumable for its 6 hours. */
  abort(): Promise<void>;
};

/** The endpoint as an absolute URL: tus-js-client resolves the server's relative `Location` against it. */
export function absoluteEndpoint(endpoint: string = UPLOADS_ENDPOINT): string {
  const base = typeof globalThis.location === 'object' && globalThis.location !== null ? globalThis.location.href : undefined;
  return new URL(endpoint, base).toString();
}

/**
 * The key the upload URL is kept under: the same file, chosen again, finds its upload. It is the hexadecimal SHA-256 of
 * the file's name, type, size and date with the endpoint, so the browser's storage shows no file name.
 */
export async function fingerprintOf(file: UploadFile, endpoint: string): Promise<string> {
  const text = ['gmshield-upload', file.name, file.type, file.size, file.lastModified ?? 0, endpoint].join('/');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return `gmshield-upload-${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Forgets every stored entry of an upload, whatever fingerprint it was kept under (a resume through `uploadUrl` keeps a
 * second one). A failure only leaves an entry that a later run resumes and completes, or the tray offers to dismiss.
 */
async function forget(storage: UrlStorage, uploadUrl: string): Promise<void> {
  try {
    for (const stored of await storage.findAllUploads()) {
      if (stored.uploadUrl === uploadUrl && typeof stored.urlStorageKey === 'string') {
        await storage.removeUpload(stored.urlStorageKey);
      }
    }
  } catch {
    // Nothing to do: the entry stays, and resuming it completes again (the backend answers the same).
  }
}

/** Statuses after which an upload is over for good: its stored entry can never be resumed (Story 1.14). */
const TERMINAL_STATUSES = new Set([400, 404, 410, 413, 415, 422]);

function isOnline(): boolean {
  const navigatorOnLine = (globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine;
  return navigatorOnLine !== false;
}

/** Whether tus-js-client should try a failed request again. */
export function shouldRetry(error: DetailedError | Error): boolean {
  const response = (error as Partial<DetailedError>).originalResponse;
  const status = response ? response.getStatus() : 0;
  return (status >= 500 || RETRIED_STATUSES.has(status)) && isOnline();
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** An {@link UploadError} from what tus-js-client or the completion reported. */
function failure(error: unknown): UploadError {
  if (error instanceof UploadError) {
    return error;
  }
  const response = (error as Partial<DetailedError> | null)?.originalResponse;
  if (response) {
    return new UploadError('The upload was refused', response.getStatus(), parsed(response.getBody()));
  }
  return new UploadError('The upload could not reach GMshield', null, null);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** `POST <upload>/completion` with the whole file's SHA-256, tried again like a part. */
async function complete(stack: HttpStack, uploadUrl: string, sha256: string, retryDelays: readonly number[]): Promise<UploadResult> {
  for (let attempt = 0; ; attempt++) {
    let status = 0;
    let problem: unknown = null;
    try {
      const request = stack.createRequest('POST', `${uploadUrl}/completion`);
      request.setHeader('Tus-Resumable', TUS_VERSION);
      request.setHeader('Content-Type', 'application/json');
      const response = await request.send(JSON.stringify({ sha256 }));
      status = response.getStatus();
      const body = parsed(response.getBody());
      if (status === 201 && typeof body === 'object' && body !== null) {
        const { materialId, versionId, state } = body as Record<string, unknown>;
        if (typeof materialId === 'string' && typeof versionId === 'string' && typeof state === 'string') {
          return { materialId, versionId, state, uploadUrl };
        }
      }
      problem = body;
    } catch {
      status = 0;
    }
    const retried = (status === 0 || status >= 500 || status === 423) && isOnline();
    const delay = retryDelays[attempt];
    if (!retried || delay === undefined) {
      throw new UploadError('The upload was not completed', status === 0 ? null : status, problem);
    }
    await wait(delay);
  }
}

/** Starts (or resumes) the upload of `file`. */
export function startUpload(file: UploadFile, options: UploadOptions = {}): UploadHandle {
  const resumeUrl = options.resumeUrl === undefined ? null : absoluteEndpoint(options.resumeUrl);
  // Resuming, the endpoint is the upload's parent: the fingerprint is the one its first run kept the URL under.
  const endpoint = resumeUrl === null ? absoluteEndpoint(options.endpoint) : resumeUrl.replace(/\/[^/]*$/, '');
  const retryDelays = options.retryDelays ?? RETRY_DELAYS;
  const stack = new ChecksumHttpStack(options.httpStack ?? new DefaultHttpStack({}));
  const storage = options.urlStorage ?? defaultOptions.urlStorage;
  const fingerprint = fingerprintOf(file, endpoint);
  let upload: Upload | null = null;
  let aborted = false;
  let stop: (error: UploadError) => void = () => undefined;

  const done = new Promise<UploadResult>((resolve, reject) => {
    stop = reject;
    // A refusal ends the upload for good: its stored entries go too. An abort, a network failure or a retried status
    // keeps them, so the upload can still be resumed.
    const end = (error: UploadError) => {
      const url = upload?.url ?? resumeUrl;
      if (error.status !== null && TERMINAL_STATUSES.has(error.status) && url !== null && url !== undefined) {
        void forget(storage, url).then(() => reject(error));
      } else {
        reject(error);
      }
    };
    const hashing = sha256OfFile(file, options.hashSliceBytes);
    // A failed hash is reported once the upload asks for it, never as an unhandled rejection meanwhile.
    hashing.catch(() => undefined);
    const tus = new Upload(file, {
      // Resume only: without an endpoint tus-js-client cannot fall back to creating a new upload.
      ...(resumeUrl === null ? { endpoint } : { uploadUrl: resumeUrl }),
      chunkSize: options.partBytes ?? PART_BYTES,
      retryDelays: [...retryDelays],
      metadata: { ...options.metadata, filename: file.name },
      storeFingerprintForResuming: true,
      // Removed only after the completion (below): a closed tab or a failed completion can still resume.
      removeFingerprintOnSuccess: false,
      fingerprint: () => fingerprint,
      onShouldRetry: (error) => shouldRetry(error),
      httpStack: stack,
      ...(options.fileReader ? { fileReader: options.fileReader } : {}),
      urlStorage: storage,
      onProgress: options.onProgress ?? null,
      onUploadUrlAvailable: () => {
        if (tus.url !== null) {
          options.onUploadUrl?.(tus.url);
        }
      },
      onChunkComplete: (_size, accepted, total) => options.onPartStored?.(accepted, total),
      onError: (error) => end(failure(error)),
      onSuccess: () => {
        const url = tus.url;
        if (url === null) {
          reject(new UploadError('The upload has no address', null, null));
          return;
        }
        hashing
          .then((sha256) => complete(stack, url, sha256, retryDelays))
          .then(async (result) => {
            await forget(storage, url);
            resolve(result);
          }, (error: unknown) => end(failure(error)));
      },
    });
    upload = tus;
    if (resumeUrl !== null) {
      tus.start();
      return;
    }
    tus
      .findPreviousUploads()
      .then((previous) => {
        if (aborted) {
          return;
        }
        const resumable = previous.find((candidate) => candidate.uploadUrl !== null);
        if (resumable !== undefined) {
          tus.resumeFromPreviousUpload(resumable);
        }
        tus.start();
      })
      .catch((error: unknown) => reject(failure(error)));
  });

  return {
    done,
    abort: async () => {
      aborted = true;
      await (upload as Upload | null)?.abort(false);
      stop(new UploadError('The upload was stopped', null, null));
    },
  };
}
