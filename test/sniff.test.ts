import { describe, expect, it } from 'vitest';

import { checkFile, MAX_FILE_BYTES, SAMPLE_BYTES, sniffFormat } from '@/client/upload/sniff';

/**
 * The browser's format check (Story 1.14) against the backend's own cases (`FormatSnifferTest`): the same bytes give
 * the same answer on both sides.
 */
const text = (value: string) => new TextEncoder().encode(value);
const zeros = (count: number) => new Uint8Array(count);
const concat = (...parts: Uint8Array[]) => {
  const all = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return all;
};
const bytes = (...values: number[]) => new Uint8Array(values);
const sniff = (content: Uint8Array, name: string) => sniffFormat(content, false, name);

describe('the browser format check (Story 1.14)', () => {
  it('recognises every accepted signature whatever the name', () => {
    expect(sniff(concat(text('%PDF-1.7\n'), bytes(0x25, 0xe2, 0xe3, 0x0a)), 'notes.txt')).toBe('pdf');
    expect(sniff(concat(bytes(0xff, 0xd8, 0xff, 0xe0), zeros(16)), 'x.md')).toBe('jpeg');
    expect(sniff(concat(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), zeros(16)), 'x')).toBe('png');
    expect(sniff(concat(text('RIFF'), bytes(0x24, 0, 0, 0), text('WEBPVP8 '), zeros(8)), 'a.webp')).toBe('webp');
    expect(sniff(concat(bytes(0x49, 0x49, 0x2a, 0), zeros(8)), 'scan.tif')).toBe('tiff');
    expect(sniff(concat(bytes(0x4d, 0x4d, 0, 0x2a), zeros(8)), 'scan.tif')).toBe('tiff');
    expect(sniff(concat(bytes(0x42, 0x4d, 0x36, 0, 0, 0, 0, 0, 0, 0), zeros(8)), 'a.bmp')).toBe('bmp');
    for (const brand of ['heic', 'heix', 'mif1', 'msf1', 'heim', 'heis', 'hevc']) {
      expect(sniff(concat(bytes(0, 0, 0, 0x18), text(`ftyp${brand}`), zeros(12)), 'photo.heic'), brand).toBe('heic');
    }
  });

  it('reads text as Markdown by its name and as plain text otherwise', () => {
    const rules = text('# Rules\n\nRoll 2d6 and add your\tbonus.\r\n\f');
    expect(sniff(rules, 'rules.md')).toBe('markdown');
    expect(sniff(rules, 'RULES.MARKDOWN ')).toBe('markdown');
    expect(sniff(rules, 'rules.txt')).toBe('txt');
    expect(sniff(rules, 'rules')).toBe('txt');
    expect(sniff(rules, 'rules.md.txt')).toBe('txt');
    expect(sniff(concat(bytes(0xef, 0xbb, 0xbf), text('Ação: 🎲 rolar')), 'a.md')).toBe('markdown');
    expect(sniff(text('BMX rules, second edition\n'), 'bmx.txt')).toBe('txt');
  });

  it('tolerates a sequence cut at the edge of the sample only when the file goes on', () => {
    const cut = text('Dano: ação').slice(0, text('Dano: a').length + 1);
    expect(sniffFormat(cut, true, 'a.txt')).toBe('txt');
    expect(sniffFormat(cut, false, 'a.txt')).toBeNull();
    const sample = new Uint8Array(SAMPLE_BYTES).fill(0x61);
    sample[sample.length - 2] = 0xf0;
    sample[sample.length - 1] = 0x9f;
    expect(sniffFormat(sample, true, 'a.txt')).toBe('txt');
  });

  it('refuses binary content even with a text name', () => {
    expect(sniff(concat(bytes(0x50, 0x4b, 3, 4), text('[Content_Types].xml')), 'rules.md')).toBeNull();
    expect(sniff(concat(bytes(0x50, 0x4b, 3, 4), zeros(30)), 'rules.pdf')).toBeNull();
    expect(sniff(text('MZ\u0090\u0000'), 'x.md')).toBeNull();
    expect(sniff(concat(text('text then'), zeros(1), text('NUL')), 'x.md')).toBeNull();
    expect(sniff(text('escape \u001b[31m red'), 'x.txt')).toBeNull();
    expect(sniff(text('delete \u007f'), 'x.txt')).toBeNull();
    expect(sniff(bytes(0x61, 0xc3, 0x28), 'x.txt')).toBeNull();
    expect(sniff(bytes(0x61, 0xc0, 0x80), 'x.txt')).toBeNull();
    expect(sniff(bytes(0xed, 0xa0, 0x80), 'x.txt')).toBeNull();
    expect(sniff(text('C1 control \u0085 here'), 'x.txt')).toBeNull();
    expect(sniff(concat(text('RIFF'), zeros(4), text('WAVE')), 'a.webp')).toBeNull();
    expect(sniff(concat(bytes(0, 0, 0, 0x18), text('ftypavif'), zeros(12)), 'a.heic')).toBeNull();
    expect(sniff(new Uint8Array(0), 'a.txt')).toBeNull();
  });

  it('checks a chosen file by its size and its first 4 KiB only, and names why it is refused', async () => {
    const zip = new File([concat(bytes(0x50, 0x4b, 3, 4), zeros(10_000))], 'campanha.zip');
    expect(await checkFile(zip)).toEqual({ ok: false, reason: 'format' });
    expect(await checkFile(new File([], 'vazio.pdf'))).toEqual({ ok: false, reason: 'empty' });
    // A 3 GB file: refused by its size before a byte is read.
    const huge = { name: 'enorme.pdf', size: 3 * 1000 ** 3, slice: () => { throw new Error('read'); } } as unknown as File;
    expect(await checkFile(huge)).toEqual({ ok: false, reason: 'too_large' });
    expect(MAX_FILE_BYTES).toBe(2 * 1024 ** 3);
    const pdf = new File([concat(text('%PDF-1.7\n'), zeros(SAMPLE_BYTES * 3))], 'Livro.pdf');
    let read = 0;
    const slice = pdf.slice.bind(pdf);
    pdf.slice = (start?: number, end?: number) => {
      read = (end ?? pdf.size) - (start ?? 0);
      return slice(start, end);
    };
    expect(await checkFile(pdf)).toEqual({ ok: true, format: 'pdf' });
    expect(read).toBe(SAMPLE_BYTES);
    // Text cut at 4 KiB in the middle of a character, in a file that goes on, is still text.
    const accented = new File([concat(new Uint8Array(SAMPLE_BYTES - 1).fill(0x61), text('ção'))], 'notas.md');
    expect(await checkFile(accented)).toEqual({ ok: true, format: 'markdown' });
  });
});
