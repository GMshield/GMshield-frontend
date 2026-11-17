import type { HttpRequest, HttpResponse, HttpStack } from 'tus-js-client';

/**
 * Wraps a tus HTTP stack so that every PATCH carries `Upload-Checksum: sha256 <Base64>` (tus's checksum extension),
 * the SHA-256 of exactly the bytes it sends, computed with `crypto.subtle.digest` just before the part leaves. The
 * backend refuses a part whose bytes differ (`upload.part_checksum_mismatch`, 460) and keeps the offset, so the part
 * is sent again. Every other request passes through unchanged.
 */
export class ChecksumHttpStack implements HttpStack {
  constructor(private readonly inner: HttpStack) {}

  createRequest(method: string, url: string): HttpRequest {
    const request = this.inner.createRequest(method, url);
    return method.toUpperCase() === 'PATCH' ? new ChecksummedRequest(request) : request;
  }

  getName(): string {
    return `checksum(${this.inner.getName()})`;
  }
}

class ChecksummedRequest implements HttpRequest {
  constructor(private readonly inner: HttpRequest) {}

  getMethod(): string {
    return this.inner.getMethod();
  }

  getURL(): string {
    return this.inner.getURL();
  }

  setHeader(header: string, value: string): void {
    this.inner.setHeader(header, value);
  }

  getHeader(header: string): string | undefined {
    return this.inner.getHeader(header);
  }

  setProgressHandler(handler: (bytesSent: number) => void): void {
    this.inner.setProgressHandler(handler);
  }

  async send(body: unknown): Promise<HttpResponse> {
    this.inner.setHeader('Upload-Checksum', `sha256 ${await partChecksum(body)}`);
    return this.inner.send(body);
  }

  abort(): Promise<void> {
    return this.inner.abort();
  }

  getUnderlyingObject(): unknown {
    return this.inner.getUnderlyingObject();
  }
}

/** The Base64 SHA-256 of a part: a Blob (the browser's file slices), bytes, or no body at all. */
export async function partChecksum(body: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await bytesOf(body));
  return base64(new Uint8Array(digest));
}

async function bytesOf(body: unknown): Promise<ArrayBuffer | Uint8Array<ArrayBuffer>> {
  if (body === null || body === undefined) {
    return new Uint8Array(0);
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return body.arrayBuffer();
  }
  if (body instanceof ArrayBuffer) {
    return body;
  }
  if (ArrayBuffer.isView(body)) {
    // A copy into a plain ArrayBuffer: a Node Buffer may be a view of a larger, shared one.
    return new Uint8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer);
  }
  throw new TypeError('A part must be a Blob or bytes to carry its checksum');
}

export function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
