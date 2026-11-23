import type { Language, Messages } from '@/messages';
import type { components } from '@/server/backend/generated/public';

/**
 * What the guided upload and the tray share (Story 1.14), with no message file and nothing server-only: the browser
 * gets its texts from the server as {@link UploadTexts}, already in the interface's language.
 */
/**
 * A material as the tray shows it: the GM's actions (Story 1.20) are the material page's alone, and so are its version
 * and where it belongs (Story 3.3).
 */
export type Material = Omit<components['schemas']['Material'], 'actions' | 'version' | 'size' | 'belonging' | 'serving' | 'superseded'>;
export type MaterialState = Material['state'];
/** A material's pages once its page total is known: done of the total, by layer and by outcome (Story 1.17). */
export type MaterialPages = NonNullable<Material['pages']>;
export type Kind = NonNullable<Material['kind']>;
export const KINDS: readonly Kind[] = ['rulebook', 'supplement', 'homebrew', 'campaign_notes', 'other'];
export type UploadLanguage = 'pt-BR' | 'en' | 'detect';
export const UPLOAD_LANGUAGES: readonly UploadLanguage[] = ['pt-BR', 'en', 'detect'];
/** Story 3.3: the three ways a material can belong, and none for a GM with no campaign and no system. */
export type BelongingChoice = 'campaign' | 'system' | 'systems' | 'none';

/** A system as the pickers offer it (Story 3.3). */
export type PlaceOption = { readonly id: string; readonly name: string };
/** A campaign as the pickers offer it, with its system, by which they are grouped (Story 3.3). */
export type CampaignOption = PlaceOption & { readonly system: PlaceOption };

/**
 * What the "where it belongs" pickers offer (Story 3.3): every campaign in use (an archived one is never offered),
 * every system, and the current campaign's id, which is chosen first; empty lists and null when there are none.
 */
export type Belonging = {
  readonly campaigns: readonly CampaignOption[];
  readonly systems: readonly PlaceOption[];
  readonly current: string | null;
};

export const NO_PLACES: Belonging = { campaigns: [], systems: [], current: null };

/** Where a material goes (Story 3.3): one campaign, one system, several systems, or none. */
export type Place =
  | { readonly choice: 'campaign'; readonly campaign: string }
  | { readonly choice: 'system'; readonly system: string }
  | { readonly choice: 'systems'; readonly systems: readonly string[] }
  | { readonly choice: 'none' };

/**
 * The pickers' state (Story 3.3): which row is chosen (null for none yet) and each row's own value ('' for nothing
 * picked), kept while another row is chosen so that going back to a row finds it as it was.
 */
export type PlaceDraft = {
  readonly choice: BelongingChoice | null;
  readonly campaign: string;
  readonly system: string;
  readonly systems: readonly string[];
};

/** The rows the pickers show: those with something to pick, or `none` alone when there is nothing. */
export function placeChoices(places: Belonging): readonly BelongingChoice[] {
  const choices: BelongingChoice[] = [];
  if (places.campaigns.length > 0) {
    choices.push('campaign');
  }
  if (places.systems.length > 0) {
    choices.push('system', 'systems');
  }
  return choices.length === 0 ? ['none'] : choices;
}

/**
 * The pickers' first state: the current campaign when there is one to offer (else the first campaign), else the first
 * system, else none; `from`, a material's place, is shown instead when the pickers can show it. When they cannot (an
 * archived campaign, a system not offered), nothing is picked: no row is chosen and the selects show no value, so that
 * saving takes an explicit pick and never moves the material by itself. With `pickFirst` false (a material's page),
 * a material with no place opens with nothing picked too.
 */
export function draftOf(places: Belonging, from: Place | null = null, pickFirst = true): PlaceDraft {
  const firstCampaign = places.campaigns.find((campaign) => campaign.id === places.current)?.id ?? places.campaigns[0]?.id ?? '';
  const firstSystem = places.systems[0]?.id ?? '';
  const draft: PlaceDraft = { choice: placeChoices(places)[0] ?? 'none', campaign: firstCampaign, system: firstSystem, systems: [] };
  const offered = (id: string) => places.systems.some((system) => system.id === id);
  if (from?.choice === 'campaign' && places.campaigns.some((campaign) => campaign.id === from.campaign)) {
    return { ...draft, choice: 'campaign', campaign: from.campaign };
  }
  if (from?.choice === 'system' && offered(from.system)) {
    return { ...draft, choice: 'system', system: from.system, systems: [from.system] };
  }
  if (from?.choice === 'systems') {
    const shown = from.systems.filter(offered);
    if (shown.length > 0) {
      return { ...draft, choice: 'systems', system: shown[0] ?? firstSystem, systems: shown };
    }
  }
  return from === null && pickFirst ? draft : { choice: null, campaign: '', system: '', systems: [] };
}

/**
 * The pickers' state against what can be picked now (the places can change while a dialog stays open): a row or a value
 * no longer offered falls back to the first state's.
 */
export function fitDraft(draft: PlaceDraft, places: Belonging): PlaceDraft {
  const first = draftOf(places);
  const systemIds = new Set(places.systems.map((system) => system.id));
  return {
    choice: draft.choice !== null && placeChoices(places).includes(draft.choice) ? draft.choice : first.choice,
    campaign: places.campaigns.some((campaign) => campaign.id === draft.campaign) ? draft.campaign : first.campaign,
    system: systemIds.has(draft.system) ? draft.system : first.system,
    systems: draft.systems.filter((id) => systemIds.has(id)),
  };
}

/** The place the pickers' state stands for, or null when the chosen row has nothing picked. */
export function placeOf(draft: PlaceDraft): Place | null {
  switch (draft.choice) {
    case 'campaign':
      return draft.campaign === '' ? null : { choice: 'campaign', campaign: draft.campaign };
    case 'system':
      return draft.system === '' ? null : { choice: 'system', system: draft.system };
    case 'systems':
      return draft.systems.length === 0 ? null : { choice: 'systems', systems: [...draft.systems] };
    case 'none':
      return { choice: 'none' };
    case null:
      return null;
  }
}

/** A material's place as the backend answers it (Story 3.3), as the pickers hold it; null for none. */
export function placeOfBelonging(belonging: components['schemas']['MaterialBelonging']): Place | null {
  if (belonging.campaign) {
    return { choice: 'campaign', campaign: belonging.campaign.id };
  }
  const [only, ...more] = belonging.systems;
  if (only === undefined) {
    return null;
  }
  return more.length === 0 ? { choice: 'system', system: only.id } : { choice: 'systems', systems: belonging.systems.map((system) => system.id) };
}

/** The answers of the dialog, the same for every file of one sending. */
export type Answers = {
  readonly kind: Kind;
  readonly belonging: Place;
  readonly language: UploadLanguage;
};

/** Story 1.21: an image of a set as the tray reads it from the server. */
export type SetImageRow = NonNullable<Material['imageSet']>['images'][number];

/** The formats an image of a set may have (the backend's `Format.IMAGE_CODES`), and those a browser can show. */
export const IMAGE_FORMATS = ['jpeg', 'png', 'webp', 'tiff', 'bmp', 'heic'] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];
export const SHOWN_FORMATS: ReadonlySet<string> = new Set(['jpeg', 'png', 'webp', 'bmp']);
/** The most images a set holds, and its bytes in all (the backend checks them again). */
export const MAX_SET_IMAGES = 500;
export const MAX_SET_BYTES = 2 * 1024 * 1024 * 1024;

export function isImageFormat(format: string | null | undefined): format is ImageFormat {
  return typeof format === 'string' && (IMAGE_FORMATS as readonly string[]).includes(format);
}

/** An image of a set as the GM chose it: its file name and size. */
export type SetImage = { readonly name: string; readonly length: number };

/**
 * What "Enviar" sends to create a set (Story 1.21): its name, the answers and its images in their confirmed order; from
 * Story 3.4, for a new version of a material, its name, the material and the images, and nothing else.
 */
export type ImageSetCreate =
  | {
      readonly name: string;
      readonly kind: Kind;
      readonly language: UploadLanguage;
      readonly campaign?: string;
      /** Story 3.3: one or more systems, never with a campaign. */
      readonly systems?: readonly string[];
      readonly material?: undefined;
      readonly images: readonly SetImage[];
    }
  | {
      readonly name: string;
      /** Story 3.4: the material the set replaces; it keeps its name, kind, language and place. */
      readonly material: string;
      readonly kind?: undefined;
      readonly language?: undefined;
      readonly campaign?: undefined;
      readonly systems?: undefined;
      readonly images: readonly SetImage[];
    };

/** A refusal of a set call, as plain fields: what `problemText` needs. */
export type SetProblem = {
  readonly status: number;
  readonly category: string;
  readonly code: string;
  readonly params: Readonly<Record<string, string | number>>;
};

export type SetCallResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly problem: SetProblem };

/** The set calls (Server Actions in the app; stand-ins in tests). */
export type ImageSetCalls = {
  readonly create: (request: ImageSetCreate) => Promise<SetCallResult<{ id: string; materialId: string; images: { position: number; uploadId: string }[] }>>;
  readonly replace: (id: string, position: number, image: SetImage) => Promise<SetCallResult<{ position: number; uploadId: string }>>;
  readonly drop: (id: string, position: number) => Promise<SetCallResult<{ state: string }>>;
};

/** What one "Enviar" sends: files that each become a material, and image sets (an image alone is a set of one). */
export type SendPlan = {
  readonly files: readonly UploadFileLike[];
  readonly sets: readonly { readonly name: string; readonly files: readonly UploadFileLike[] }[];
};

/** A file to upload (the upload client's `UploadFile`), named here so this module stays free of the client. */
export type UploadFileLike = Blob & { readonly name: string; readonly lastModified?: number };

/** A file name without its extension: the default name of a set, from its first image. */
export function withoutExtension(name: string): string {
  const trimmed = name.trim();
  const dot = trimmed.lastIndexOf('.');
  return dot > 0 ? trimmed.slice(0, dot) : trimmed;
}

/** Every text the dialog, the tray and the announcements show, in one language. */
export type UploadTexts = {
  readonly language: Language;
  readonly upload: Messages['upload'];
  readonly states: Messages['material']['state'];
  /** "{done} de {total} páginas": the pages of a material being processed (Story 1.15). */
  readonly pages: Messages['material']['pages'];
  /** "lendo texto", "lendo por OCR": the word of a processing material while pages of that kind wait (Story 1.17). */
  readonly phases: Messages['material']['phase'];
  /** "{percent}%": the bytes of a live upload sent so far (Story 1.17). */
  readonly percent: Messages['material']['percent'];
  /** Problem texts by code (`upload.too_large`) and by category (`upload`); `server` is the fallback. */
  readonly errors: Readonly<Record<string, string>>;
};

/** What is being read, and its measure: text pages while any wait, then image pages, else every page. */
export type Progress = { readonly phase: keyof Messages['material']['phase'] | null; readonly done: number; readonly total: number };

/**
 * A processing material's measure (Story 1.17), from what the backend reports (it names no phase): the layer of the
 * pages the step in progress reads (`reading`), so OCR between two batches of text pages reads "lendo por OCR"; when
 * it is null, its text pages while any of them wait, then its image pages (read by OCR) while any of them wait, else
 * all its pages.
 */
export function progressOf(pages: MaterialPages): Progress {
  if (pages.reading === 'text') {
    return { phase: 'text', done: pages.text.done, total: pages.text.total };
  }
  if (pages.reading === 'image') {
    return { phase: 'ocr', done: pages.image.done, total: pages.image.total };
  }
  if (pages.text.done < pages.text.total) {
    return { phase: 'text', done: pages.text.done, total: pages.text.total };
  }
  if (pages.image.done < pages.image.total) {
    return { phase: 'ocr', done: pages.image.done, total: pages.image.total };
  }
  return { phase: null, done: pages.done, total: pages.total };
}

/** States in which a material is still moving: the tray refreshes while one of its rows is in one. */
export const MOVING_STATES: readonly MaterialState[] = ['uploading', 'waiting', 'processing'];

const PLACEHOLDER = /\{(\w+)\}/g;

/** Fills each `{name}` that `params` has (the browser's own copy of `interpolate`). */
export function fill(text: string, params: Readonly<Record<string, string | number>> = {}): string {
  return text.replace(PLACEHOLDER, (placeholder, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : placeholder));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The text for a problem detail: its code's, else its category's, else the generic one. A code is never shown. */
export function problemText(problem: unknown, errors: UploadTexts['errors']): string {
  const fallback = errors.server ?? '';
  if (!isRecord(problem)) {
    return fallback;
  }
  const code = typeof problem.code === 'string' ? problem.code : null;
  const category = typeof problem.category === 'string' ? problem.category : null;
  if (code !== null && Object.hasOwn(errors, code)) {
    return errors[code] ?? fallback;
  }
  if (category !== null && Object.hasOwn(errors, category)) {
    return errors[category] ?? fallback;
  }
  return fallback;
}

/** The last segment of an upload's address: its id. */
export function uploadIdOf(uploadUrl: string): string {
  return uploadUrl.split('/').filter((part) => part !== '').pop() ?? '';
}

/** A size in bytes, in the interface's language: "12,3 MB". */
export function formatSize(bytes: number, language: Language): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value)} ${units[unit]}`;
}
