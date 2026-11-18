/**
 * The browser's own check of a chosen file (Story 1.14), before any upload starts: the same rules as the backend's
 * `FormatSniffer` over the same first 4 KiB, and the same 2 GiB limit. The backend still decides (its 415 counts); this
 * only spares the GM an upload that would be refused.
 *
 * The signature of a PDF, JPEG, PNG, WebP, TIFF or HEIC, then text, then BMP. Text is valid UTF-8 (a byte order mark
 * is allowed, and a sequence cut at the end of the sample is tolerated when the file goes on), with no NUL and no
 * control character other than tab, line feed, carriage return and form feed. The name only tells Markdown from plain
 * text. BMP comes after text because `BM` may also begin a text.
 */
export const SAMPLE_BYTES = 4096;
/** The largest file: 2 GiB, as the backend's `Uploads.MAX_LENGTH`. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

export const FORMATS = ['pdf', 'txt', 'markdown', 'jpeg', 'png', 'webp', 'tiff', 'bmp', 'heic'] as const;
export type Format = (typeof FORMATS)[number];

/** Why a file is refused before it is sent. */
export type Refusal = 'empty' | 'too_large' | 'format';

export type FileCheck = { readonly ok: true; readonly format: Format } | { readonly ok: false; readonly reason: Refusal };

const PDF = ascii('%PDF-');
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const TIFF_LITTLE = [0x49, 0x49, 0x2a, 0x00];
const TIFF_BIG = [0x4d, 0x4d, 0x00, 0x2a];
const HEIC_BRANDS = new Set(['heic', 'heix', 'mif1', 'msf1', 'heim', 'heis', 'hevc']);

function ascii(text: string): number[] {
  return Array.from(text, (character) => character.charCodeAt(0));
}

function startsWith(sample: Uint8Array, prefix: readonly number[]): boolean {
  return sample.length >= prefix.length && prefix.every((byte, index) => sample[index] === byte);
}

function region(sample: Uint8Array, from: number, count: number): string {
  return String.fromCharCode(...sample.subarray(from, from + count));
}

function isControl(code: number): boolean {
  if (code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0c) {
    return false;
  }
  return code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
}

/** Valid UTF-8 without NUL or a control character other than tab, LF, CR and FF. */
export function isText(sample: Uint8Array, more: boolean): boolean {
  if (sample.length === 0) {
    return false;
  }
  let text: string;
  try {
    // Streaming keeps a sequence cut at the end of the sample instead of refusing it: only when the file goes on.
    text = new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: more });
  } catch {
    return false;
  }
  // The decoder drops a leading byte order mark itself.
  for (let index = 0; index < text.length; index++) {
    if (isControl(text.charCodeAt(index))) {
      return false;
    }
  }
  return true;
}

/** A text file's format: Markdown when its name ends in `.md` or `.markdown`, else plain text. */
function textNamed(name: string): Format {
  const lower = name.trim().toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown') ? 'markdown' : 'txt';
}

/** The format of a file whose first bytes are `sample`; `more` says whether the file goes on after them. */
export function sniffFormat(sample: Uint8Array, more: boolean, name: string): Format | null {
  if (startsWith(sample, PDF)) {
    return 'pdf';
  }
  if (startsWith(sample, JPEG)) {
    return 'jpeg';
  }
  if (startsWith(sample, PNG)) {
    return 'png';
  }
  if (sample.length >= 12 && region(sample, 0, 4) === 'RIFF' && region(sample, 8, 4) === 'WEBP') {
    return 'webp';
  }
  if (startsWith(sample, TIFF_LITTLE) || startsWith(sample, TIFF_BIG)) {
    return 'tiff';
  }
  if (sample.length >= 12 && region(sample, 4, 4) === 'ftyp' && HEIC_BRANDS.has(region(sample, 8, 4))) {
    return 'heic';
  }
  if (isText(sample, more)) {
    return textNamed(name);
  }
  if (startsWith(sample, ascii('BM'))) {
    return 'bmp';
  }
  return null;
}

/** Checks a chosen file: its size, then its first 4 KiB. Nothing is sent. */
export async function checkFile(file: Blob & { readonly name: string }): Promise<FileCheck> {
  if (file.size === 0) {
    return { ok: false, reason: 'empty' };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, reason: 'too_large' };
  }
  const sample = new Uint8Array(await file.slice(0, SAMPLE_BYTES).arrayBuffer());
  const format = sniffFormat(sample, file.size > SAMPLE_BYTES, file.name);
  return format === null ? { ok: false, reason: 'format' } : { ok: true, format };
}
