import { createSHA256 } from 'hash-wasm';

/** How much of the file is read at a time for its whole-file hash. */
export const HASH_SLICE_BYTES = 16 * 1024 * 1024;

/**
 * The SHA-256 of a whole file in lower-case hexadecimal, computed incrementally, one slice at a time, so a 2 GB file
 * is never in memory at once (only one slice is). `onSlice` hears the bytes hashed so far.
 */
export async function sha256OfFile(
  file: Blob,
  sliceBytes: number = HASH_SLICE_BYTES,
  onSlice?: (hashed: number, total: number) => void,
): Promise<string> {
  if (!Number.isInteger(sliceBytes) || sliceBytes < 1) {
    throw new RangeError('The slice size must be a positive whole number');
  }
  const hasher = await createSHA256();
  hasher.init();
  for (let start = 0; start < file.size; start += sliceBytes) {
    const end = Math.min(start + sliceBytes, file.size);
    hasher.update(new Uint8Array(await file.slice(start, end).arrayBuffer()));
    onSlice?.(end, file.size);
  }
  return hasher.digest('hex');
}
