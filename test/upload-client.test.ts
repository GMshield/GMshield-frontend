import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { FileReader, HttpRequest, HttpResponse, HttpStack, PreviousUpload, UrlStorage } from 'tus-js-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChecksumHttpStack, partChecksum } from '@/client/upload/checksum-stack';
import { sha256OfFile } from '@/client/upload/file-hash';
import { PART_BYTES, UploadError, absoluteEndpoint, fingerprintOf, shouldRetry, startUpload } from '@/client/upload';

const KIB = 1024;

function sha256(bytes: Uint8Array): Buffer {
  return createHash('sha256').update(bytes).digest();
}

/** A file of `size` bytes whose content depends on the position. */
function fileOf(size: number, name = 'Livro do Jogador.pdf'): File {
  const content = new Uint8Array(size);
  content.set(new TextEncoder().encode('%PDF-1.7\n'));
  for (let i = 9; i < size; i++) {
    content[i] = (i * 31 + (i >>> 7)) & 0xff;
  }
  return new File([content], name, { type: 'application/pdf', lastModified: 1_700_000_000_000 });
}

/** Under Node, tus-js-client reads Buffers: this reader hands it the Blob's slices as bytes, slice by slice. */
const blobReader: FileReader = {
  async openFile(input: Blob) {
    return {
      size: input.size,
      async slice(start: number, end: number) {
        // tus-js-client reads a part's length from `size`, as its own Buffer source sets it.
        const bytes = Buffer.from(await input.slice(start, end).arrayBuffer());
        const value = Object.assign(bytes, { size: bytes.length });
        return { value, done: end >= input.size };
      },
      close() {},
    };
  },
};

/** The browser keeps upload URLs in localStorage; here, in a map. */
function memoryStorage(): UrlStorage & { entries: Map<string, PreviousUpload & { fingerprint: string }> } {
  const entries = new Map<string, PreviousUpload & { fingerprint: string }>();
  let next = 0;
  return {
    entries,
    async findAllUploads() {
      return [...entries.values()];
    },
    async findUploadsByFingerprint(fingerprint: string) {
      return [...entries.values()].filter((entry) => entry.fingerprint === fingerprint);
    },
    async removeUpload(key: string) {
      entries.delete(key);
    },
    async addUpload(fingerprint: string, upload: PreviousUpload) {
      const key = `tus::${fingerprint}::${next++}`;
      entries.set(key, { ...upload, fingerprint, urlStorageKey: key });
      return key;
    },
  };
}

type Call = { method: string; url: string; headers: IncomingMessage['headers']; body: Buffer };

/**
 * A tus 1.0.0 backend in miniature, as the relay presents it: it checks each part's `Upload-Checksum` against the
 * bytes it received and the completion's hash against the whole file, like the real one.
 */
async function startTusServer(options: { failFirstPatchWith?: number; refuseFirstPatch?: unknown } = {}) {
  const calls: Call[] = [];
  const uploads = new Map<string, { length: number; data: Buffer[]; offset: number }>();
  let failures = options.failFirstPatchWith === undefined ? 0 : 1;
  let refusal = options.refuseFirstPatch;
  let created = 0;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      calls.push({ method: request.method ?? '', url: request.url ?? '', headers: { ...request.headers }, body });
      answer(request, response, body);
    });
  });
  function problem(response: ServerResponse, status: number, code: string, params: Record<string, unknown> = {}): void {
    response.writeHead(status, { 'Content-Type': 'application/problem+json', 'Tus-Resumable': '1.0.0' });
    response.end(JSON.stringify({ status, category: code.split('.')[0], code, params, traceId: 't' }));
  }
  function answer(request: IncomingMessage, response: ServerResponse, body: Buffer): void {
    if (request.headers['tus-resumable'] !== '1.0.0') {
      return problem(response, 412, 'upload.tus_version');
    }
    const url = request.url ?? '';
    if (request.method === 'POST' && url === '/api/v1/uploads') {
      const id = `0190a0b0-0000-7000-8000-${String(++created).padStart(12, '0')}`;
      uploads.set(id, { length: Number(request.headers['upload-length']), data: [], offset: 0 });
      response.writeHead(201, { Location: `/api/v1/uploads/${id}`, 'Tus-Resumable': '1.0.0' });
      return void response.end();
    }
    const match = /^\/api\/v1\/uploads\/([^/]+)(\/completion)?$/.exec(url);
    const upload = match ? uploads.get(match[1]!) : undefined;
    if (match === null || upload === undefined) {
      return problem(response, 404, 'request.not_found');
    }
    if (request.method === 'HEAD') {
      response.writeHead(200, { 'Upload-Offset': String(upload.offset), 'Upload-Length': String(upload.length), 'Tus-Resumable': '1.0.0' });
      return void response.end();
    }
    if (request.method === 'PATCH') {
      if (refusal !== undefined) {
        refusal = undefined;
        return problem(response, 415, 'upload.format_refused', { accepted: ['pdf'] });
      }
      if (failures > 0) {
        failures--;
        return problem(response, options.failFirstPatchWith!, 'upload.part_checksum_mismatch');
      }
      if (Number(request.headers['upload-offset']) !== upload.offset) {
        return problem(response, 409, 'upload.offset_conflict');
      }
      if (request.headers['upload-checksum'] !== `sha256 ${sha256(body).toString('base64')}`) {
        return problem(response, 460, 'upload.part_checksum_mismatch');
      }
      upload.data.push(body);
      upload.offset += body.length;
      response.writeHead(204, { 'Upload-Offset': String(upload.offset), 'Tus-Resumable': '1.0.0' });
      return void response.end();
    }
    if (request.method === 'POST' && match[2] !== undefined) {
      const { sha256: expected } = JSON.parse(body.toString('utf8')) as { sha256: string };
      if (upload.offset !== upload.length) {
        return problem(response, 409, 'upload.incomplete');
      }
      if (sha256(Buffer.concat(upload.data)).toString('hex') !== expected) {
        return problem(response, 422, 'upload.file_checksum_mismatch');
      }
      response.writeHead(201, { 'Content-Type': 'application/json', 'Tus-Resumable': '1.0.0' });
      return void response.end(JSON.stringify({ materialId: 'm-1', versionId: 'v-1', state: 'waiting' }));
    }
    return problem(response, 405, 'request.method_not_allowed');
  }
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}/api/v1/uploads`,
    calls,
    uploads,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

describe('browser upload module (Story 1.13)', () => {
  let server: Awaited<ReturnType<typeof startTusServer>> | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
    vi.restoreAllMocks();
  });

  it('sends 64 MiB parts to the relay of this site by default', () => {
    expect(PART_BYTES).toBe(64 * 1024 * 1024);
    expect(absoluteEndpoint('http://127.0.0.1:3000/api/v1/uploads')).toBe('http://127.0.0.1:3000/api/v1/uploads');
    vi.stubGlobal('location', { href: 'https://gmshield.example/files/add' });
    try {
      expect(absoluteEndpoint()).toBe('https://gmshield.example/api/v1/uploads');
    } finally {
      vi.unstubAllGlobals();
    }
    const file = fileOf(10);
    expect(fingerprintOf(file, 'e')).toBe(fingerprintOf(fileOf(10), 'e'));
    expect(fingerprintOf(file, 'e')).not.toBe(fingerprintOf(fileOf(11), 'e'));
  });

  it('gives each part the SHA-256 of its own bytes, hashes the file in slices and completes the upload', async () => {
    server = await startTusServer();
    const file = fileOf(256 * KIB + 100);
    const slices = vi.spyOn(file, 'slice');
    const stored: number[] = [];

    const result = await startUpload(file, {
      endpoint: server.endpoint,
      partBytes: 100 * KIB,
      hashSliceBytes: 64 * KIB,
      fileReader: blobReader,
      urlStorage: memoryStorage(),
      onPartStored: (bytes) => stored.push(bytes),
    }).done;

    expect(result).toMatchObject({ materialId: 'm-1', versionId: 'v-1', state: 'waiting' });
    expect(result.uploadUrl).toMatch(/\/api\/v1\/uploads\/0190a0b0-0000-7000-8000-000000000001$/);
    const creation = server.calls.find((call) => call.method === 'POST' && call.url === '/api/v1/uploads')!;
    expect(creation.headers['upload-length']).toBe(String(file.size));
    expect(creation.headers['upload-metadata']).toBe(`filename ${Buffer.from(file.name).toString('base64')}`);
    const patches = server.calls.filter((call) => call.method === 'PATCH');
    expect(patches.map((call) => call.headers['upload-offset'])).toEqual(['0', String(100 * KIB), String(200 * KIB)]);
    for (const patch of patches) {
      expect(patch.headers['upload-checksum']).toBe(`sha256 ${sha256(patch.body).toString('base64')}`);
      expect(patch.headers['tus-resumable']).toBe('1.0.0');
    }
    expect(stored).toEqual([100 * KIB, 200 * KIB, file.size]);
    const completion = server.calls.at(-1)!;
    expect(completion.url).toMatch(/\/completion$/);
    expect(completion.headers['tus-resumable']).toBe('1.0.0');
    const whole = sha256(new Uint8Array(await file.arrayBuffer())).toString('hex');
    expect(JSON.parse(completion.body.toString('utf8'))).toEqual({ sha256: whole });
    // The whole-file hash read the file in 64 KiB slices: five of them, never the file at once.
    expect(slices.mock.calls.filter(([start, end]) => (end ?? 0) - (start ?? 0) === 64 * KIB)).toHaveLength(4);
    expect(slices.mock.calls.every(([start, end]) => (end ?? file.size) - (start ?? 0) <= 100 * KIB)).toBe(true);
  });

  it('resumes from a stored URL: it asks the offset and sends no earlier part again', async () => {
    server = await startTusServer();
    const storage = memoryStorage();
    const file = fileOf(300 * KIB);
    const options = { endpoint: server.endpoint, partBytes: 100 * KIB, fileReader: blobReader, urlStorage: storage, retryDelays: [] };

    const first = startUpload(file, {
      ...options,
      onPartStored: (bytes: number) => {
        if (bytes === 100 * KIB) {
          void first.abort();
        }
      },
    });
    await expect(first.done).rejects.toBeInstanceOf(UploadError);
    expect([...storage.entries.values()]).toHaveLength(1);
    const before = server.calls.length;

    const result = await startUpload(file, options).done;

    expect(result.state).toBe('waiting');
    const second = server.calls.slice(before);
    expect(second.filter((call) => call.method === 'POST' && call.url === '/api/v1/uploads')).toHaveLength(0);
    expect(second[0]!.method).toBe('HEAD');
    expect(second.filter((call) => call.method === 'PATCH').map((call) => call.headers['upload-offset'])).toEqual([
      String(100 * KIB),
      String(200 * KIB),
    ]);
    // Once verified, the stored URL is gone: the same file chosen again is a new upload.
    expect(storage.entries.size).toBe(0);
  });

  it('sends a part again after a checksum mismatch, and reports a refusal with its problem', async () => {
    server = await startTusServer({ failFirstPatchWith: 460 });
    const file = fileOf(50 * KIB);
    const result = await startUpload(file, { endpoint: server.endpoint, fileReader: blobReader, urlStorage: memoryStorage(), retryDelays: [0] }).done;
    expect(result.state).toBe('waiting');
    expect(server.calls.filter((call) => call.method === 'PATCH')).toHaveLength(2);
    await server.close();

    server = await startTusServer({ refuseFirstPatch: true });
    const refused = startUpload(fileOf(10, 'archive.zip'), { endpoint: server.endpoint, fileReader: blobReader, urlStorage: memoryStorage(), retryDelays: [0] }).done;
    const error = await refused.catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(UploadError);
    expect((error as UploadError).status).toBe(415);
    expect((error as UploadError).problem).toMatchObject({ code: 'upload.format_refused' });
    expect(server.calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
  });

  it('retries a server failure, a conflict, a lock and a damaged part, but not a refusal', () => {
    const failed = (status: number) => ({ originalResponse: { getStatus: () => status } }) as unknown as Error;
    for (const status of [0, 409, 423, 460, 500, 503]) {
      expect(shouldRetry(failed(status)), String(status)).toBe(true);
    }
    for (const status of [400, 401, 404, 410, 413, 415, 422]) {
      expect(shouldRetry(failed(status)), String(status)).toBe(false);
    }
    expect(shouldRetry(new Error('network'))).toBe(true);
  });
});

describe('part checksums and the whole-file hash', () => {
  it('hashes a Blob, bytes or nothing', async () => {
    const text = new TextEncoder().encode('The quick brown fox jumps over the lazy dog');
    const expected = sha256(text).toString('base64');
    expect(await partChecksum(new Blob([text]))).toBe(expected);
    expect(await partChecksum(text)).toBe(expected);
    expect(await partChecksum(Buffer.concat([Buffer.from('xx'), Buffer.from(text)]).subarray(2))).toBe(expected);
    expect(await partChecksum(text.buffer)).toBe(expected);
    expect(await partChecksum(null)).toBe('47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
    await expect(partChecksum('text')).rejects.toBeInstanceOf(TypeError);
  });

  it('adds the checksum to PATCH only', async () => {
    const sent: { method: string; headers: Map<string, string> }[] = [];
    const inner: HttpStack = {
      getName: () => 'fake',
      createRequest(method: string, url: string): HttpRequest {
        const headers = new Map<string, string>();
        sent.push({ method, headers });
        return {
          getMethod: () => method,
          getURL: () => url,
          setHeader: (name, value) => void headers.set(name, value),
          getHeader: (name) => headers.get(name),
          setProgressHandler: () => undefined,
          send: async () => ({ getStatus: () => 204, getHeader: () => undefined, getBody: () => '', getUnderlyingObject: () => null }) as HttpResponse,
          abort: async () => undefined,
          getUnderlyingObject: () => null,
        };
      },
    };
    const stack = new ChecksumHttpStack(inner);
    expect(stack.getName()).toBe('checksum(fake)');
    await stack.createRequest('PATCH', 'u').send(new Uint8Array([1, 2, 3]));
    await stack.createRequest('HEAD', 'u').send(null);
    await stack.createRequest('POST', 'u').send(null);
    expect(sent[0]!.headers.get('Upload-Checksum')).toBe(`sha256 ${sha256(new Uint8Array([1, 2, 3])).toString('base64')}`);
    expect(sent[1]!.headers.has('Upload-Checksum')).toBe(false);
    expect(sent[2]!.headers.has('Upload-Checksum')).toBe(false);
  });

  it('computes the whole-file SHA-256 slice by slice', async () => {
    const file = fileOf(1000);
    const progress: number[] = [];
    const hex = await sha256OfFile(file, 300, (hashed) => progress.push(hashed));
    expect(hex).toBe(sha256(new Uint8Array(await file.arrayBuffer())).toString('hex'));
    expect(progress).toEqual([300, 600, 900, 1000]);
    expect(await sha256OfFile(new Blob([]))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    await expect(sha256OfFile(file, 0)).rejects.toBeInstanceOf(RangeError);
  });
});
