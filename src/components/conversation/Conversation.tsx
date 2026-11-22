'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { parseCitation, parseDone, parseTier, postQuestion, stopTurn, turnEventsUrl, type Citation, type SourceReference, type TierStart } from '@/client/conversation';
import { errorText, translator, type Language, type Translate } from '@/messages';

import { ShellPanel } from '../ShellPanel';
import { SourceView, type LoadPage } from '../SourceView';
import { TIER_SEPARATOR, tierWord } from '../TierLabel';
import { useUploads } from '../uploads/UploadsProvider';

import { AnswerMarkdown, type CitationMark, type TierMark } from './AnswerMarkdown';
import { NamedIcon } from '../Icons';

import styles from './Conversation.module.css';
import { References, referenceLine } from './References';

/** The most lines the composer grows to; past them it scrolls. */
export const COMPOSER_MAX_LINES = 6;
/** Where the unsent question of a campaign is kept in this browser (Story 2.4). */
export const DRAFT_PREFIX = 'gmshield:draft:';
/** `EventSource.CLOSED`, without reading the browser global. */
const CLOSED = 2;

/** Story 2.6: the first wait before the page reopens a stream the browser gave up, doubling up to the longest. */
export const REOPEN_FIRST_MS = 1000;
export const REOPEN_LONGEST_MS = 15_000;
/** Story 2.6: how long a lost connection may go without an `open` before the page stops trying. */
export const RECONNECT_GIVE_UP_MS = 120_000;

type TurnStatus = 'sending' | 'searching' | 'answering' | 'done' | 'stopped' | 'failed';
/** The statuses of an answer still running: the send button is Stop, and Enter sends nothing. */
const RUNNING: ReadonlySet<TurnStatus> = new Set<TurnStatus>(['sending', 'searching', 'answering']);

/**
 * How an answer failed (Story 2.6), from its `error` event's code: each has its own text. A provider's prompt filter
 * that flagged the question or a source (Story 2.8) is a refusal of its own.
 */
type Failure = 'refused' | 'questionFlagged' | 'sourceFlagged' | 'unavailable' | 'truncated';
/** The failures that act as a refusal: no retry, and the question goes back to the composer. */
const REFUSALS: ReadonlySet<Failure> = new Set<Failure>(['refused', 'questionFlagged', 'sourceFlagged']);
/** The `error` codes with a failure of their own; any other code is an outage. */
const FAILURES: ReadonlyMap<string, Failure> = new Map<string, Failure>([
  ['model.refused', 'refused'],
  ['model.question_flagged', 'questionFlagged'],
  ['model.source_flagged', 'sourceFlagged'],
  ['model.truncated', 'truncated'],
]);
/** The state of a running answer's stream: open, lost while it reconnects, or given up (Story 2.6). */
type Connection = 'open' | 'lost' | 'failed';

/**
 * A turn asked since the page opened: its question, then its answer as it is written. Story 2.5: its citations as they
 * arrive, and once it is done its references, or `silent` when it has none. Story 2.6: how it failed, and its stream's
 * connection. Story 2.7: its id once known, which names its references to the source view. Story 3.7: its tier events
 * as they arrive (each tier's version of the answer starts at its offset).
 */
type ShownTurn = {
  readonly key: number;
  readonly id: string | null;
  readonly question: string;
  readonly status: TurnStatus;
  readonly language: string | null;
  readonly text: string;
  readonly problem: unknown;
  readonly citations: readonly Citation[];
  readonly tiers: readonly TierStart[];
  readonly references: readonly SourceReference[];
  readonly silent: boolean;
  readonly failure: Failure | null;
  readonly connection: Connection;
};

/**
 * What the polite region says: plain words, or an answer (rendered, with its tier pills, Story 3.7) followed by a note
 * (Story 2.6: "Interrompida") and its references as a list.
 */
type Spoken = {
  readonly text: string;
  readonly answer: boolean;
  readonly references: readonly SourceReference[];
  readonly note: string;
  readonly tiers: readonly TierMark[];
};

/** A running answer's stream, as the page holds it: closed on leaving, reopened by "Tentar de novo". */
type Follower = { readonly close: () => void; readonly reopen: () => void; readonly connection: () => Connection };

/** The failure of an `error` event's code: a refusal (or a flagged question or source), a truncation, or an outage. */
function failureOf(code: string | null): Failure {
  return (code === null ? undefined : FAILURES.get(code)) ?? 'unavailable';
}

/** The superscripts of a finished answer: each citation whose passage is in a reference, with its number. */
function marksOf(turn: ShownTurn): CitationMark[] {
  const numbers = new Map<string, number>();
  for (const reference of turn.references) {
    for (const passageId of reference.passageIds) {
      if (!numbers.has(passageId)) {
        numbers.set(passageId, reference.number);
      }
    }
  }
  return turn.citations.flatMap((citation) => {
    const number = numbers.get(citation.passageId);
    return number === undefined ? [] : [{ offset: citation.offset, number }];
  });
}

/**
 * Story 3.7: the tier pills of a finished answer, each with its word in the interface's language. A pill says the
 * sources disagree, so the markers are tidied first: in text order, one whose tier repeats the one before it is dropped,
 * and none is drawn unless at least two tiers are left.
 */
function tierMarksOf(starts: readonly TierStart[], t: Translate): TierMark[] {
  const ordered = [...starts].sort((one, other) => one.offset - other.offset);
  const kept = ordered.filter((start, index) => index === 0 || start.tier !== ordered[index - 1]?.tier);
  if (new Set(kept.map((start) => start.tier)).size < 2) {
    return [];
  }
  return kept.map((start) => ({ offset: start.offset, tier: start.tier, label: tierWord(start.tier, t) }));
}

/** The turn's language when the interface has it, else the interface's. */
function languageOf(turnLanguage: string | null, fallback: Language): Language {
  return turnLanguage === 'pt-BR' || turnLanguage === 'en' ? turnLanguage : fallback;
}

export type ConversationProps = {
  readonly language: Language;
  readonly campaignId: string;
  readonly hasSources: boolean;
  /** The newest material that needs review, when there is one. */
  readonly review: { readonly href: string; readonly name: string } | null;
  /** For tests: how a stream of a turn is opened (the browser's `EventSource` by default). */
  readonly openStream?: (url: string) => EventSource;
  /** For tests: how the source view reads a page (the relay by default). */
  readonly loadPage?: LoadPage;
};

/**
 * The reference open in the source view (Story 2.7): its turn's id, the reference, and how many times a reference was
 * opened, so selecting the open reference again reopens it at its cited page.
 */
type OpenSource = { readonly turnId: string; readonly reference: SourceReference; readonly opened: number };

function readDraft(campaignId: string): string {
  try {
    return globalThis.localStorage?.getItem(`${DRAFT_PREFIX}${campaignId}`) ?? '';
  } catch {
    return '';
  }
}

function writeDraft(campaignId: string, text: string): void {
  try {
    if (text === '') {
      globalThis.localStorage?.removeItem(`${DRAFT_PREFIX}${campaignId}`);
    } else {
      globalThis.localStorage?.setItem(`${DRAFT_PREFIX}${campaignId}`, text);
    }
  } catch {
    // A browser that keeps nothing: the draft lives as long as the page.
  }
}

/** The data of an event as JSON, or null when it is not an object. */
function dataOf(event: Event): Record<string, unknown> | null {
  if (!(event instanceof MessageEvent) || typeof event.data !== 'string') {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(event.data);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A new turn of `question`, waiting for its id. */
function newTurn(key: number, question: string): ShownTurn {
  return {
    key,
    id: null,
    question,
    status: 'sending',
    language: null,
    text: '',
    problem: null,
    citations: [],
    tiers: [],
    references: [],
    silent: false,
    failure: null,
    connection: 'open',
  };
}

/** A numeric event id, or null for one that is not a sequence. */
function sequenceOf(id: string): number | null {
  return /^\d{1,18}$/.test(id) ? Number(id) : null;
}

/**
 * The conversation screen with no campaign (Story 3.2): every campaign is archived or gone, so nothing can be asked. The
 * composer is there but disabled, with the reason above it and a link to `/campaigns/new`; the reason names the
 * disabled field (`aria-describedby`).
 */
export function NoCampaignConversation({ language }: { readonly language: Language }) {
  const t = translator(language);
  return (
    <section className={styles.conversation} aria-label={t('conversation.heading')}>
      <h1 className={styles.visuallyHidden}>{t('conversation.heading')}</h1>
      <div className={styles.dock}>
        <p className={styles.empty} id="conversation-no-campaign" data-testid="conversation-no-campaign">
          <span>{t('conversation.noCampaign')}</span>
          <Link className={styles.emptyAction} href="/campaigns/new">
            {t('conversation.newCampaign')}
          </Link>
        </p>
        <form className={styles.composer}>
          <label className={styles.visuallyHidden} htmlFor="conversation-question">
            {t('conversation.composer.label')}
          </label>
          <textarea
            id="conversation-question"
            className={styles.field}
            rows={1}
            placeholder={t('conversation.composer.placeholder')}
            disabled
            aria-describedby="conversation-no-campaign"
          />
          <button type="submit" className={styles.send} aria-label={t('conversation.composer.send')} disabled>
            <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="24" height="24">
              <path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </form>
      </div>
    </section>
  );
}

/**
 * The conversation screen (Story 2.4): the turns asked since the page opened, and the composer.
 *
 * - The composer is a pill: Enter sends, Shift+Enter adds a line, and it grows to six lines. Its draft is kept per
 *   campaign in this browser and cleared on send.
 * - A question shows at once, muted, with "Procurando nas fontes…"; its answer streams in as sanitized Markdown, in the
 *   answer size, with no bubble, card or avatar, closed by a rule. An answer in another language than the interface's
 *   is marked with its own (`lang` and a visible label).
 * - A polite live region says "Respondendo…" when the answer starts and the whole answer once it is done.
 * - Story 2.5: once the answer is done, each citation whose passage is in a reference becomes an accent superscript with
 *   that reference's number, and the numbered references are listed under the answer, above the closing rule. A silent
 *   answer (no reference) replaces whatever streamed with the one "the sources say nothing" sentence, in the turn's
 *   language. Nothing of this shows while the answer streams. The polite region says the answer, then the references.
 * - Story 2.6, stop: while an answer runs, the send button is Stop (a square, "Parar"), Esc anywhere on the screen does
 *   the same, and Enter sends nothing (the draft stays). A stop pressed before the turn's id is known is sent once it
 *   is. A stopped answer keeps its text, its superscripts and its references, marked "Interrompida", and is never the
 *   silent sentence.
 * - Story 2.6, lost connection: while the browser reconnects, "Conexão perdida. Tentando de novo…" shows under the
 *   text until the next `open`. When the browser gives up, the page reopens the stream itself from the last event id,
 *   waiting 1 s, 2 s, 4 s… up to 15 s between tries. After 2 minutes without an `open`, the line says "Não foi possível
 *   reconectar." with "Tentar de novo", which reopens it.
 * - Story 2.6, failures: an `error` event's code has its own text, said at once by an assertive region. A refusal
 *   (Story 2.8: or a prompt filter that flagged the question or a source, each with its own text) hides the partial
 *   text and puts the question back in an empty composer; an outage (any other code) hides it too
 *   and offers "Tentar de novo"; a truncation keeps it, with its own text and "Tentar de novo". "Tentar de novo" asks
 *   the same question again as a new turn, in place of the failed one.
 * - With no accepted source, a line above the composer says so, with the guided upload and the newest material to
 *   review; asking still works.
 */
export function Conversation({ language, campaignId, hasSources, review, openStream, loadPage }: ConversationProps) {
  const t = translator(language);
  const uploads = useUploads();
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<readonly ShownTurn[]>([]);
  const [spoken, setSpoken] = useState<Spoken>({ text: '', answer: false, references: [], note: '', tiers: [] });
  const [alerted, setAlerted] = useState('');
  const counter = useRef(0);
  const followers = useRef(new Map<number, Follower>());
  /** The ids of the turns asked, by key, as soon as they are known; and the keys whose stop waits for one. */
  const turnIds = useRef(new Map<number, string>());
  const pendingStops = useRef(new Set<number>());
  /** Story 2.7: the reference open in the source view, the button that opened it, and whether focus goes back to it. */
  const [source, setSource] = useState<OpenSource | null>(null);
  const sourceOpener = useRef<HTMLButtonElement | null>(null);
  const focusOpener = useRef(false);
  const openings = useRef(0);

  useEffect(() => {
    // Read after the first render, so the server's and the browser's first renders agree.
    let current = true;
    void Promise.resolve().then(() => {
      const kept = readDraft(campaignId);
      if (current && kept !== '') {
        setDraft((typed) => (typed === '' ? kept : typed));
      }
    });
    return () => {
      current = false;
    };
  }, [campaignId]);

  useEffect(() => {
    const open = followers.current;
    return () => {
      for (const follower of open.values()) {
        follower.close();
      }
      open.clear();
    };
  }, []);

  /**
   * Says `text` politely; an answer is said as it reads, its Markdown rendered as on the screen, then its note, then
   * its references as a list.
   */
  const say = useCallback(
    (text: string, answer = false, references: readonly SourceReference[] = [], note = '', tiers: readonly TierMark[] = []) => {
      // A zero-width space alternates so that the same words are said again.
      setSpoken((previous) => ({ text: previous.text === text ? `${text}\u200b` : text, answer, references, note, tiers }));
    },
    [],
  );

  /** Says `text` at once, in the assertive region (Story 2.6: a failure). */
  const announce = useCallback((text: string) => {
    setAlerted((previous) => (previous === text ? `${text}\u200b` : text));
  }, []);

  const change = useCallback((key: number, update: (turn: ShownTurn) => ShownTurn) => {
    setTurns((all) => all.map((turn) => (turn.key === key ? update(turn) : turn)));
  }, []);

  /** Puts a question back in the composer and its draft, unless the GM has started another. */
  const restore = useCallback(
    (question: string) => {
      setDraft((typed) => {
        if (typed !== '') {
          return typed;
        }
        writeDraft(campaignId, question);
        return question;
      });
    },
    [campaignId],
  );

  const follow = useCallback(
    (key: number, turnId: string, turnLanguage: string | null, question: string) => {
      const open = openStream ?? ((url: string) => new EventSource(url));
      let text = '';
      const citations: Citation[] = [];
      const tiers: TierStart[] = [];
      let lastId: string | null = null;
      let current: EventSource | null = null;
      let ended = false;
      let gaveUp = false;
      let delay = REOPEN_FIRST_MS;
      let reopenTimer: ReturnType<typeof setTimeout> | undefined;
      let giveUpTimer: ReturnType<typeof setTimeout> | undefined;
      let connection: Connection = 'open';
      /** The stream's connection, kept here (for a stop that must reopen it) and on the screen. */
      const setConnection = (now: Connection) => {
        connection = now;
        change(key, (turn) => (turn.connection === now ? turn : { ...turn, connection: now }));
      };

      const clearTimers = () => {
        clearTimeout(reopenTimer);
        clearTimeout(giveUpTimer);
        reopenTimer = undefined;
        giveUpTimer = undefined;
      };
      const closeCurrent = () => {
        current?.close();
        current = null;
      };
      const finish = () => {
        ended = true;
        clearTimers();
        closeCurrent();
        followers.current.delete(key);
      };
      /** Whether an event is after the last one received (a reconnection never repeats text); records its id. */
      const fresh = (event: Event): boolean => {
        const id = event instanceof MessageEvent ? event.lastEventId : '';
        const sequence = sequenceOf(id);
        if (sequence === null) {
          return true;
        }
        const last = lastId === null ? null : sequenceOf(lastId);
        if (last !== null && sequence <= last) {
          return false;
        }
        lastId = id;
        return true;
      };
      const giveUp = () => {
        gaveUp = true;
        clearTimers();
        closeCurrent();
        setConnection('failed');
        say(t('conversation.reconnectFailed'));
      };
      const lost = () => {
        if (giveUpTimer !== undefined || gaveUp) {
          return;
        }
        setConnection('lost');
        say(t('conversation.connectionLost'));
        giveUpTimer = setTimeout(giveUp, RECONNECT_GIVE_UP_MS);
      };

      const connect = () => {
        const stream = open(turnEventsUrl(turnId, lastId));
        current = stream;
        stream.addEventListener('open', () => {
          if (stream !== current) {
            return;
          }
          delay = REOPEN_FIRST_MS;
          clearTimeout(giveUpTimer);
          giveUpTimer = undefined;
          setConnection('open');
        });
        stream.addEventListener('delta', (event) => {
          const data = dataOf(event);
          if (typeof data?.text === 'string' && fresh(event)) {
            text += data.text;
            const now = text;
            change(key, (turn) => ({ ...turn, status: 'answering', text: now }));
          }
        });
        stream.addEventListener('citation', (event) => {
          // Kept, not shown: the superscripts wait for the references the done event carries.
          const citation = parseCitation(dataOf(event));
          if (citation !== null && fresh(event)) {
            citations.push(citation);
          }
        });
        stream.addEventListener('tier', (event) => {
          // Story 3.7: kept, not shown, like a citation: the pills appear with the superscripts once the answer is done.
          const start = parseTier(dataOf(event));
          if (start !== null && fresh(event)) {
            tiers.push(start);
          }
        });
        stream.addEventListener('done', (event) => {
          if (!fresh(event)) {
            return;
          }
          finish();
          const done = parseDone(dataOf(event));
          const kept = [...citations];
          const opened = [...tiers];
          if (done.stopped) {
            // Story 2.6: the text so far stays, marked stopped, with its references; never the silent sentence.
            change(key, (turn) => ({
              ...turn,
              status: 'stopped',
              connection: 'open',
              citations: kept,
              tiers: opened,
              references: done.references,
              silent: false,
            }));
            if (text === '') {
              say(t('conversation.stopped'), false, done.references);
            } else {
              say(text, true, done.references, t('conversation.stopped'), tierMarksOf(opened, t));
            }
            return;
          }
          change(key, (turn) => ({
            ...turn,
            status: 'done',
            connection: 'open',
            citations: kept,
            tiers: opened,
            references: done.references,
            silent: done.silent,
          }));
          if (done.silent) {
            say(translator(languageOf(turnLanguage, language))('conversation.silent'));
          } else {
            say(text, true, done.references, '', tierMarksOf(opened, t));
          }
        });
        stream.addEventListener('error', (event) => {
          if (stream !== current) {
            return;
          }
          const data = dataOf(event);
          if (data === null) {
            // The connection itself. While the stream is open the browser reconnects from the last event id; once it
            // gives up, the page reopens it, backing off, until the give-up time.
            lost();
            if (stream.readyState === CLOSED && !ended && !gaveUp) {
              closeCurrent();
              const wait = delay;
              delay = Math.min(delay * 2, REOPEN_LONGEST_MS);
              reopenTimer = setTimeout(() => {
                reopenTimer = undefined;
                if (!ended && !gaveUp) {
                  connect();
                }
              }, wait);
            }
            return;
          }
          if (!fresh(event)) {
            return;
          }
          finish();
          const code = typeof data.code === 'string' ? data.code : null;
          const failure = failureOf(code);
          change(key, (turn) => ({
            ...turn,
            status: 'failed',
            connection: 'open',
            failure,
            problem: { code, category: null },
          }));
          announce(t(`conversation.${failure}`));
          if (REFUSALS.has(failure)) {
            restore(question);
          }
        });
      };

      followers.current.set(key, {
        close: finish,
        connection: () => connection,
        reopen: () => {
          if (ended) {
            return;
          }
          gaveUp = false;
          delay = REOPEN_FIRST_MS;
          clearTimers();
          closeCurrent();
          setConnection('lost');
          say(t('conversation.connectionLost'));
          giveUpTimer = setTimeout(giveUp, RECONNECT_GIVE_UP_MS);
          connect();
        },
      });
      connect();
    },
    [announce, change, language, openStream, restore, say, t],
  );

  /** Asks `question` as a new turn, at the end or (Story 2.6: "Tentar de novo") in place of the turn `replacing`. */
  /**
   * Sends the stop of the turn `key` (Story 2.6). A refused stop says the generic server text at once; an accepted one
   * whose stream is not open (lost, or given up) reopens it, so the stopped `done` arrives.
   */
  const sendStop = useCallback(
    async (key: number, turnId: string) => {
      if (!(await stopTurn(turnId))) {
        announce(errorText({ category: 'server', code: 'server.unavailable' }, language));
        return;
      }
      const follower = followers.current.get(key);
      if (follower !== undefined && follower.connection() !== 'open') {
        follower.reopen();
      }
    },
    [announce, language],
  );

  const ask = useCallback(
    async (question: string, replacing?: number) => {
      if (replacing !== undefined) {
        turnIds.current.delete(replacing);
        pendingStops.current.delete(replacing);
      }
      counter.current += 1;
      const key = counter.current;
      const added = newTurn(key, question);
      setTurns((all) => (replacing === undefined ? [...all, added] : all.map((turn) => (turn.key === replacing ? added : turn))));
      const asked = await postQuestion(campaignId, question);
      if (!asked.ok) {
        pendingStops.current.delete(key);
        // A refused question is not lost: it goes back to the composer unless the GM has started another.
        restore(question);
        change(key, (turn) => ({ ...turn, status: 'failed', problem: asked.problem }));
        say(errorText(asked.problem, language));
        return;
      }
      turnIds.current.set(key, asked.turn.id);
      change(key, (turn) => ({ ...turn, id: asked.turn.id, status: 'searching', language: asked.turn.language }));
      say(t('conversation.answering'));
      follow(key, asked.turn.id, asked.turn.language, question);
      if (pendingStops.current.delete(key)) {
        void sendStop(key, asked.turn.id);
      }
    },
    [campaignId, change, follow, language, restore, say, sendStop, t],
  );

  const active = turns.find((turn) => RUNNING.has(turn.status));
  const running = active !== undefined;
  const activeKey = active?.key;

  /** Stops the running answer (Story 2.6); before its id is known, once it is. */
  const stop = useCallback(() => {
    if (activeKey === undefined) {
      return;
    }
    const turnId = turnIds.current.get(activeKey);
    if (turnId === undefined) {
      pendingStops.current.add(activeKey);
    } else {
      void sendStop(activeKey, turnId);
    }
  }, [activeKey, sendStop]);

  // Usability pass, third round: a question that was just asked comes to the top of the window with its answer under
  // it. The turns only grow, so without this a new question landed below the docked composer once the conversation was
  // longer than the window, and the GM had to scroll down to read what they had just asked for. Only a new turn moves
  // the page (never a delta of the answer), so reading back while an answer is written is not interrupted.
  const lastTurn = useRef<HTMLLIElement | null>(null);
  const shownTurns = useRef(0);
  useEffect(() => {
    if (turns.length > shownTurns.current) {
      const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      lastTurn.current?.scrollIntoView?.({ block: 'start', behavior: still ? 'auto' : 'smooth' });
    }
    shownTurns.current = turns.length;
  }, [turns.length]);

  useEffect(() => {
    if (!running) {
      return undefined;
    }
    const onEscape = (event: globalThis.KeyboardEvent) => {
      // Esc inside a dialog (the guided upload) closes that dialog and leaves the answer alone.
      const inDialog = event.target instanceof Element && event.target.closest('dialog, [role="dialog"]') !== null;
      // Esc that only cancels an IME composition is not a stop.
      if (event.key === 'Escape' && !event.isComposing && !event.defaultPrevented && !inDialog) {
        stop();
      }
    };
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('keydown', onEscape);
    };
  }, [running, stop]);

  /**
   * Opens a reference's page in the source view (Story 2.7); another reference replaces it and its focus target, and
   * the open one selected again reopens at its cited page with focus on the close control.
   */
  const openSource = useCallback((turnId: string, reference: SourceReference, button: HTMLButtonElement) => {
    sourceOpener.current = button;
    openings.current += 1;
    setSource({ turnId, reference, opened: openings.current });
  }, []);

  const closeSource = useCallback(() => {
    focusOpener.current = true;
    setSource(null);
  }, []);

  // Closed: focus goes back to the reference that opened it, once the main column is no longer behind the panel.
  useEffect(() => {
    if (source !== null || !focusOpener.current) {
      return;
    }
    focusOpener.current = false;
    const opener = sourceOpener.current;
    sourceOpener.current = null;
    if (opener?.isConnected) {
      opener.focus();
    }
  }, [source]);

  const send = useCallback(async () => {
    const question = draft;
    if (running || question.trim() === '') {
      return;
    }
    setDraft('');
    writeDraft(campaignId, '');
    await ask(question);
  }, [ask, campaignId, draft, running]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  const linkText = (text: string, address: string) => t('conversation.link', { text, address });
  const lines = Math.min(COMPOSER_MAX_LINES, Math.max(1, draft.split('\n').length));

  return (
    <section className={styles.conversation} aria-label={t('conversation.heading')}>
      <h1 className={styles.visuallyHidden}>{t('conversation.heading')}</h1>
      {turns.length === 0 ? (
        <div className={styles.intro} data-testid="conversation-intro">
          <span className={styles.introIcon}>
            <NamedIcon name="questions" size={28} />
          </span>
          <p className={styles.introTitle}>{t('conversation.intro.title')}</p>
          <p className={styles.introText}>{t('conversation.intro.text')}</p>
        </div>
      ) : null}
      <ol className={styles.turns} aria-label={t('conversation.turns')}>
        {turns.map((turn, index) => {
          const foreign = turn.language !== null && turn.language !== language;
          const languageName = turn.language === 'pt-BR' || turn.language === 'en' ? t(`conversation.languages.${turn.language}`) : turn.language;
          const finished = turn.status === 'done' || turn.status === 'stopped';
          const silent = turn.status === 'done' && turn.silent;
          // A refusal and an outage show in place of the answer: what streamed is hidden. A truncation keeps it.
          const hidden = turn.status === 'failed' && turn.failure !== 'truncated';
          const turnId = turn.id;
          return (
            <li key={turn.key} className={styles.turn} ref={index === turns.length - 1 ? lastTurn : undefined}>
              <p className={styles.question}>
                <span className={styles.visuallyHidden}>{`${t('conversation.question')}: `}</span>
                {turn.question}
              </p>
              {turn.status === 'sending' || turn.status === 'searching' ? (
                <p className={styles.waiting}>{t('conversation.searching')}</p>
              ) : null}
              {silent ? (
                <div className={styles.answer} lang={foreign ? (turn.language ?? undefined) : undefined}>
                  <p>{translator(languageOf(turn.language, language))('conversation.silent')}</p>
                </div>
              ) : null}
              {silent || hidden || turn.text === '' ? null : (
                <div className={styles.answer} lang={foreign ? (turn.language ?? undefined) : undefined}>
                  {foreign ? <p className={styles.languageLabel}>{t('conversation.answerIn', { language: languageName ?? '' })}</p> : null}
                  <AnswerMarkdown
                    text={turn.text}
                    linkText={linkText}
                    marks={finished ? marksOf(turn) : []}
                    citationWord={translator(languageOf(turn.language, language))('conversation.citation')}
                    tiers={finished ? tierMarksOf(turn.tiers, t) : []}
                  />
                </div>
              )}
              {RUNNING.has(turn.status) && turn.connection !== 'open' ? (
                <p className={styles.connection}>
                  <span>{t(turn.connection === 'lost' ? 'conversation.connectionLost' : 'conversation.reconnectFailed')}</span>
                  {turn.connection === 'failed' ? (
                    <button type="button" className={styles.retry} onClick={() => followers.current.get(turn.key)?.reopen()}>
                      {t('conversation.retry')}
                    </button>
                  ) : null}
                </p>
              ) : null}
              {turn.status === 'stopped' ? <p className={styles.stopped}>{t('conversation.stopped')}</p> : null}
              {finished && !silent && turn.references.length > 0 ? (
                <References
                  references={turn.references}
                  t={t}
                  onOpen={turnId === null ? undefined : (reference, button) => openSource(turnId, reference, button)}
                />
              ) : null}
              {turn.status === 'failed' && turn.failure === null ? <p className={styles.failed}>{errorText(turn.problem, language)}</p> : null}
              {turn.status === 'failed' && turn.failure !== null ? (
                <p className={styles.failed}>
                  <span>{t(`conversation.${turn.failure}`)}</span>
                  {REFUSALS.has(turn.failure) ? null : (
                    <button type="button" className={styles.retry} disabled={running} onClick={() => void ask(turn.question, turn.key)}>
                      {t('conversation.retry')}
                    </button>
                  )}
                </p>
              ) : null}
              {finished || turn.status === 'failed' ? <hr className={styles.rule} /> : null}
            </li>
          );
        })}
      </ol>
      <div className={styles.dock}>
        {hasSources ? null : (
          <p className={styles.empty} data-testid="conversation-empty">
            <span>{t('conversation.empty.noSources')}</span>
            <button type="button" className={styles.emptyAction} onClick={() => uploads.openUpload()}>
              {t('conversation.empty.upload')}
            </button>
            {review === null ? null : (
              <a className={styles.emptyAction} href={review.href}>
                {t('conversation.empty.review', { name: review.name })}
              </a>
            )}
          </p>
        )}
        <form className={styles.composer} onSubmit={onSubmit}>
          <label className={styles.visuallyHidden} htmlFor="conversation-question">
            {t('conversation.composer.label')}
          </label>
          <textarea
            id="conversation-question"
            className={styles.field}
            rows={lines}
            value={draft}
            placeholder={t('conversation.composer.placeholder')}
            maxLength={4000}
            onChange={(event) => {
              setDraft(event.target.value);
              writeDraft(campaignId, event.target.value);
            }}
            onKeyDown={onKeyDown}
          />
          {running ? (
            <button
              type="button"
              className={styles.send}
              aria-label={t('conversation.stop')}
              onClick={(event) => {
                // A double-click on Send lands its second click here: only a single click stops.
                if (event.detail <= 1) {
                  stop();
                }
              }}
            >
              <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="24" height="24">
                <rect className={styles.stopGlyph} x="7" y="7" width="10" height="10" rx="1" />
              </svg>
            </button>
          ) : (
            <button type="submit" className={styles.send} aria-label={t('conversation.composer.send')}>
              <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="24" height="24">
                <path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </form>
      </div>
      <div className={styles.visuallyHidden} aria-live="polite" data-testid="conversation-polite">
        {spoken.answer ? <AnswerMarkdown text={spoken.text} linkText={linkText} tiers={spoken.tiers} /> : spoken.text}
        {spoken.note === '' ? null : <p>{spoken.note}</p>}
        {spoken.references.length === 0 ? null : (
          <ol aria-label={t('conversation.references')}>
            {spoken.references.map((reference) => (
              <li key={reference.number} value={reference.number}>
                {reference.tier === undefined ? null : `${tierWord(reference.tier, t)}${TIER_SEPARATOR}`}
                {referenceLine(reference, t)}
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className={styles.visuallyHidden} role="alert" data-testid="conversation-alert">
        {alerted}
      </div>
      {source === null ? null : (
        <ShellPanel>
          <SourceView
            key={`${source.turnId}:${source.reference.number}:${source.opened}`}
            turnId={source.turnId}
            reference={source.reference}
            language={language}
            onClose={closeSource}
            load={loadPage}
          />
        </ShellPanel>
      )}
    </section>
  );
}
