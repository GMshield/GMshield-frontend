'use server';

import { refresh } from 'next/cache';

import type { ImageSetCreate, SetCallResult, SetImage } from '@/components/uploads/types';
import { problemFields } from '@/messages';
import { createImageSet, dropSetImage, replaceSetImage, type ImageSetRequest } from '@/server/materials';
import { currentSessionToken } from '@/server/session-cookies';

/**
 * The guided upload's calls for an image set (Story 1.21), as Server Actions the browser calls: the set's creation
 * when the GM presses "Enviar" (its order confirmed), and, in the tray, a failed image's replacement ("Substituir") or
 * its removal ("Continuar sem ela"). Each checks what the browser sent before it reaches the backend, sends the
 * session's token, and answers the backend's data or its problem (status, category, code and plain params only),
 * which the browser turns into text. The proxy (src/proxy.ts) and Next.js refuse a cross-origin call before this runs.
 * The images themselves go through the upload relay (`/api/v1/uploads/{id}`), never through here.
 */
const ID = /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
const KINDS = new Set(['rulebook', 'supplement', 'homebrew', 'campaign_notes', 'other']);
const LANGUAGES = new Set(['pt-BR', 'en', 'detect']);
/** The backend's limits, checked again there: 500 images, 2 GiB a file and in all. */
const MAX_IMAGES = 500;
const MAX_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_NAME = 255;

const INVALID = { ok: false, problem: { status: 400, category: 'request', code: 'request.invalid', params: {} } } as const;
const SESSION_REQUIRED = { ok: false, problem: { status: 401, category: 'session', code: 'session.required', params: {} } } as const;

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && [...value].length <= MAX_NAME;
}

function isImage(value: unknown): value is SetImage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { name, length } = value as Record<string, unknown>;
  return isName(name) && Number.isSafeInteger(length) && (length as number) >= 1 && (length as number) <= MAX_BYTES;
}

function isPosition(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= MAX_IMAGES;
}

function failed(status: number, problem: unknown): SetCallResult<never> {
  const fields = problemFields(problem);
  return {
    ok: false,
    problem: { status: fields.status ?? status, category: fields.category ?? 'server', code: fields.code ?? 'server.unexpected', params: fields.params },
  };
}

/** The set's creation: its name, the answers of the dialog and its images in their confirmed order. */
export async function createImageSetAction(request: ImageSetCreate): Promise<SetCallResult<{ id: string; materialId: string; images: { position: number; uploadId: string }[] }>> {
  if (typeof request !== 'object' || request === null) {
    return INVALID;
  }
  const { name, kind, language, campaign, system, images } = request as Partial<ImageSetCreate>;
  if (
    !isName(name) ||
    !KINDS.has(String(kind)) ||
    !LANGUAGES.has(String(language)) ||
    (campaign !== undefined && (typeof campaign !== 'string' || !ID.test(campaign))) ||
    (system !== undefined && (typeof system !== 'string' || !ID.test(system))) ||
    (campaign !== undefined && system !== undefined) ||
    !Array.isArray(images) ||
    images.length === 0 ||
    images.length > MAX_IMAGES ||
    !images.every(isImage)
  ) {
    return INVALID;
  }
  const token = await currentSessionToken();
  if (token === null) {
    return SESSION_REQUIRED;
  }
  const body: ImageSetRequest = {
    name,
    kind: kind as ImageSetRequest['kind'],
    language: language as ImageSetRequest['language'],
    images: images.map((image) => ({ name: image.name, length: image.length })),
    ...(campaign === undefined ? {} : { campaign }),
    ...(system === undefined ? {} : { system }),
  };
  const result = await createImageSet(token, body);
  if (!result.ok) {
    return failed(result.status, result.problem);
  }
  return {
    ok: true,
    data: { id: result.data.id, materialId: result.data.materialId, images: result.data.images.map(({ position, uploadId }) => ({ position, uploadId })) },
  };
}

/** A new upload for the failed image at `position` of the set `id`. */
export async function replaceSetImageAction(id: string, position: number, image: SetImage): Promise<SetCallResult<{ position: number; uploadId: string }>> {
  if (typeof id !== 'string' || !ID.test(id) || !isPosition(position) || !isImage(image)) {
    return INVALID;
  }
  const token = await currentSessionToken();
  if (token === null) {
    return SESSION_REQUIRED;
  }
  const result = await replaceSetImage(token, id, position, { name: image.name, length: image.length });
  if (!result.ok) {
    return failed(result.status, result.problem);
  }
  return { ok: true, data: { position: result.data.position, uploadId: result.data.uploadId } };
}

/** Leaves out the failed image at `position` of the set `id`; the tray is refreshed to the set as it is now. */
export async function dropSetImageAction(id: string, position: number): Promise<SetCallResult<{ state: string }>> {
  if (typeof id !== 'string' || !ID.test(id) || !isPosition(position)) {
    return INVALID;
  }
  const token = await currentSessionToken();
  if (token === null) {
    return SESSION_REQUIRED;
  }
  const result = await dropSetImage(token, id, position);
  refresh();
  if (!result.ok) {
    return failed(result.status, result.problem);
  }
  return { ok: true, data: { state: result.data.state } };
}
