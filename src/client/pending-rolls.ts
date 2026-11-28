import { sendRoll, type NewRoll, type StoredRoll } from './rolls';

/**
 * The browser's pending rolls (Story 6.4 part B, AD-31): every roll made on a Shield's screen is written here before it is
 * sent, and leaves once the backend confirms it (200 or 201). A refusal (400, 404 or 409, with or without a problem body)
 * keeps it as `refused` until the GM removes it: nothing leaves without the GM, so a stale tab of another account or a
 * proxy's 404 never deletes a roll. Anything else (401, another status, a timeout, no connection) keeps it `pending`, to be
 * sent again. This module keeps only the pending list in browser storage.
 *
 * The list of an account's Shield lives in `localStorage` under `gmshield:rolls:{accountId}:{shieldId}`. Every read and
 * write is guarded: when storage is unavailable or a write fails, the list lives in this tab's memory (part A's
 * behaviour: the roll shows and is sent, and is lost with the tab); malformed data under a key is ignored, never thrown.
 * Without an account id (it could not be read) the list is this tab's only.
 *
 * {@link flush} is the one sender: the Shield's screen and the signed-in layout's sync both go through it, so a key is
 * never in flight twice in one tab (another tab may send it too; the backend answers a held key with the stored roll, so
 * a repeat is harmless), and its results reach every open screen ({@link subscribe}, {@link onOutcome}). It sends nothing
 * while the browser says it is offline. Another account's lists are never read, sent or removed.
 */

/** A roll waiting in the browser: as sent, with its campaign, its total and whether the backend refused it. */
export type PendingRoll = {
  readonly key: string;
  readonly campaignId: string;
  readonly formula: string;
  readonly results: readonly number[];
  readonly total: number;
  readonly label: string | null;
  readonly rolledAt: string;
  readonly state: 'pending' | 'refused';
};

/**
 * A send that ended saved, for the screens that show the roll: the backend holds it; `stored` is its answer when it read,
 * `created` whether it is new.
 */
export type Outcome = {
  readonly kind: 'saved';
  readonly accountId: string | null;
  readonly shieldId: string;
  readonly roll: PendingRoll;
  readonly stored: StoredRoll | null;
  readonly created: boolean;
};

const PREFIX = 'gmshield:rolls:';
/** The lists of a page that has no account id: in this tab's memory only, never in storage. */
const TAB_PREFIX = 'tab:rolls:';

const NONE: readonly PendingRoll[] = Object.freeze([]);

/** Lists held in memory: the tab-only ones, and those whose last write to storage failed (memory then decides). */
const memory = new Map<string, readonly PendingRoll[]>();
/** The keys of the rolls being sent, each with its list. */
const inFlight = new Map<string, string>();
const listeners = new Set<() => void>();
const outcomeListeners = new Set<(outcome: Outcome) => void>();
let version = 0;
const snapshots = new Map<string, { readonly version: number; readonly list: readonly PendingRoll[] }>();

function accountPrefix(accountId: string | null): string {
  return accountId === null ? TAB_PREFIX : `${PREFIX}${accountId}:`;
}

function listKey(accountId: string | null, shieldId: string): string {
  return `${accountPrefix(accountId)}${shieldId}`;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isPendingRoll(value: unknown): value is PendingRoll {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const roll = value as Record<string, unknown>;
  return (
    typeof roll.key === 'string' &&
    roll.key !== '' &&
    typeof roll.campaignId === 'string' &&
    roll.campaignId !== '' &&
    typeof roll.formula === 'string' &&
    Array.isArray(roll.results) &&
    roll.results.every((result) => Number.isInteger(result)) &&
    Number.isInteger(roll.total) &&
    (roll.label === null || typeof roll.label === 'string') &&
    typeof roll.rolledAt === 'string' &&
    !Number.isNaN(Date.parse(roll.rolledAt)) &&
    (roll.state === 'pending' || roll.state === 'refused')
  );
}

/** The list under a key: memory's when it holds one, else storage's; the well-formed entries only, each key once. */
function read(key: string): readonly PendingRoll[] {
  const held = memory.get(key);
  if (held !== undefined || key.startsWith(TAB_PREFIX)) {
    return held ?? NONE;
  }
  try {
    const text = storage()?.getItem(key);
    if (text === null || text === undefined) {
      return NONE;
    }
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      return NONE;
    }
    const seen = new Set<string>();
    return parsed.filter((entry): entry is PendingRoll => {
      if (!isPendingRoll(entry) || seen.has(entry.key)) {
        return false;
      }
      seen.add(entry.key);
      return true;
    });
  } catch {
    return NONE;
  }
}

/** Writes a list (an empty one removes the key); when storage refuses, memory keeps it for this tab. */
function write(key: string, list: readonly PendingRoll[]): void {
  if (key.startsWith(TAB_PREFIX)) {
    if (list.length === 0) {
      memory.delete(key);
    } else {
      memory.set(key, list);
    }
    return;
  }
  try {
    const kept = storage();
    if (kept === null) {
      throw new Error('no storage');
    }
    if (list.length === 0) {
      kept.removeItem(key);
    } else {
      kept.setItem(key, JSON.stringify(list));
    }
    memory.delete(key);
  } catch {
    memory.set(key, list);
  }
}

function changed(): void {
  version += 1;
  for (const listener of [...listeners]) {
    listener();
  }
}

function onStorage(event: StorageEvent): void {
  // Another tab changed a list (or cleared storage): every open screen reads its list again.
  if (event.key === null || event.key.startsWith(PREFIX)) {
    changed();
  }
}

/** Every list key of the account: in storage and in memory. */
function keysOf(accountId: string | null): string[] {
  const prefix = accountPrefix(accountId);
  const keys = new Set<string>();
  for (const key of memory.keys()) {
    if (key.startsWith(prefix)) {
      keys.add(key);
    }
  }
  if (accountId !== null) {
    try {
      const kept = storage();
      for (let index = 0; kept !== null && index < kept.length; index += 1) {
        const key = kept.key(index);
        if (key !== null && key.startsWith(prefix)) {
          keys.add(key);
        }
      }
    } catch {
      // Storage that cannot be listed: memory's lists only.
    }
  }
  return [...keys].filter((key) => {
    const shieldId = key.slice(prefix.length);
    return shieldId !== '' && !shieldId.includes(':');
  });
}

/** Changes one roll of a list as it is now (another sender or tab may have changed the rest). */
function update(key: string, rollKey: string, next: (roll: PendingRoll) => PendingRoll | null): void {
  const list = read(key);
  if (!list.some((roll) => roll.key === rollKey)) {
    return;
  }
  write(
    key,
    list.flatMap((roll) => {
      if (roll.key !== rollKey) {
        return [roll];
      }
      const changedRoll = next(roll);
      return changedRoll === null ? [] : [changedRoll];
    }),
  );
}

function tell(outcome: Outcome): void {
  for (const listener of [...outcomeListeners]) {
    listener(outcome);
  }
}

/** Sends one roll and settles it by the backend's answer. */
async function send(accountId: string | null, shieldId: string, key: string, roll: PendingRoll): Promise<void> {
  const body: NewRoll = {
    key: roll.key,
    formula: roll.formula,
    results: [...roll.results],
    ...(roll.label === null ? {} : { label: roll.label }),
    rolledAt: roll.rolledAt,
  };
  const result = await sendRoll(roll.campaignId, shieldId, body);
  inFlight.delete(roll.key);
  const status = result.ok ? (result.created ? 201 : 200) : result.status;
  if (status === 200 || status === 201) {
    update(key, roll.key, () => null);
    changed();
    tell({ kind: 'saved', accountId, shieldId, roll, stored: result.ok ? result.roll : null, created: status === 201 });
  } else if (status === 400 || status === 404 || status === 409) {
    update(key, roll.key, (kept) => ({ ...kept, state: 'refused' }));
    changed();
  } else {
    // Signed out, unavailable, timed out or no connection: it stays pending, to be sent again.
    changed();
  }
}

/** Keeps a new roll as pending, before it is sent. */
export function addPending(accountId: string | null, shieldId: string, roll: Omit<PendingRoll, 'state'>): void {
  const key = listKey(accountId, shieldId);
  const list = read(key);
  if (!list.some((kept) => kept.key === roll.key)) {
    write(key, [...list, { ...roll, state: 'pending' }]);
  }
  changed();
}

/** Removes one roll from the list (the GM removing a refused roll). */
export function removeRoll(accountId: string | null, shieldId: string, rollKey: string): void {
  update(listKey(accountId, shieldId), rollKey, () => null);
  changed();
}

/**
 * Removes every pending and refused roll of the Shield (before its stored rolls are cleared), and answers what it removed,
 * so a clear that fails can put them back ({@link restoreRolls}).
 */
export function dropShield(accountId: string | null, shieldId: string): readonly PendingRoll[] {
  const key = listKey(accountId, shieldId);
  const dropped = read(key);
  write(key, NONE);
  changed();
  return dropped;
}

/** Puts rolls back in the Shield's list, each with its state, after the ones it holds now (a clear that failed). */
export function restoreRolls(accountId: string | null, shieldId: string, rolls: readonly PendingRoll[]): void {
  const key = listKey(accountId, shieldId);
  const list = read(key);
  const held = new Set(list.map((roll) => roll.key));
  write(key, [...list, ...rolls.filter((roll) => !held.has(roll.key))]);
  changed();
}

/** The Shield's pending and refused rolls in this browser, oldest first; the same list until it changes. */
export function pendingFor(accountId: string | null, shieldId: string): readonly PendingRoll[] {
  const key = listKey(accountId, shieldId);
  const cached = snapshots.get(key);
  if (cached?.version === version) {
    return cached.list;
  }
  const list = read(key);
  const same = cached !== undefined && cached.list.length === list.length && cached.list.every((roll, index) => sameRoll(roll, list[index]!));
  const kept = same ? cached.list : list;
  snapshots.set(key, { version, list: kept });
  return kept;
}

function sameRoll(a: PendingRoll, b: PendingRoll): boolean {
  return a.key === b.key && a.state === b.state;
}

/** The server's snapshot: nothing is pending while rendering there. */
export function noPending(): readonly PendingRoll[] {
  return NONE;
}

/** Whether a roll of the Shield is being sent in this tab. */
export function sendingFor(accountId: string | null, shieldId: string): boolean {
  const key = listKey(accountId, shieldId);
  for (const held of inFlight.values()) {
    if (held === key) {
      return true;
    }
  }
  return false;
}

/**
 * Sends every pending roll of the account, across all its Shields, that is not already on its way; nothing while the
 * browser says it is offline. Resolves once each send it started is settled.
 */
export async function flush(accountId: string | null): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return;
  }
  const sends: Promise<void>[] = [];
  for (const key of keysOf(accountId)) {
    const shieldId = key.slice(accountPrefix(accountId).length);
    for (const roll of read(key)) {
      if (roll.state !== 'pending' || inFlight.has(roll.key)) {
        continue;
      }
      inFlight.set(roll.key, key);
      sends.push(send(accountId, shieldId, key, roll));
    }
  }
  if (sends.length > 0) {
    changed();
  }
  await Promise.all(sends);
}

/** Listens for any change of the lists or of what is in flight (for `useSyncExternalStore`), here or in another tab. */
export function subscribe(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
  };
}

/** Listens for what each send ended in. */
export function onOutcome(listener: (outcome: Outcome) => void): () => void {
  outcomeListeners.add(listener);
  return () => {
    outcomeListeners.delete(listener);
  };
}

/** For tests: forgets this tab's memory and what is in flight (a new tab). */
export function resetPendingRolls(): void {
  memory.clear();
  inFlight.clear();
  snapshots.clear();
  changed();
}
