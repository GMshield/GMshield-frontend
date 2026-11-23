'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import {
  MODEL_TIER,
  defaultName,
  isRecordReference,
  parseCitation,
  parseDone,
  parseTier,
  postQuestion,
  setBookmark,
  setDismissal,
  stopTurn,
  turnEventsUrl,
  type Area,
  type Citation,
  type SourceReference,
  type StoredTurn,
  type TierStart,
} from '@/client/conversation';
import { errorText, translator, type Language, type Translate } from '@/messages';

import { useSavedItems } from '../saved/SavedItems';
import { useOptionalScopePopover } from '../ScopePopoverContext';
import { ShellPanel } from '../ShellPanel';
import { SourceView, type LoadPage } from '../SourceView';
import { TIER_SEPARATOR, tierSpoken, tierWord } from '../TierLabel';
import { useUploads } from '../uploads/UploadsProvider';

import { AnswerMarkdown, type CitationMark, type TierMark } from './AnswerMarkdown';
import { ConversationDeleteAction, type ConversationDeleteState } from './ConversationDeleteAction';
import { ConversationTimeline } from './ConversationTimeline';
import { showTurn } from './show-turn';
import { NamedIcon } from '../Icons';
import { PillButton } from '../PillButton';
import { PillLink } from '../PillLink';

import styles from './Conversation.module.css';
import { References, recordHeading, referenceLine } from './References';

/** The most lines the composer grows to; past them it scrolls. */
export const COMPOSER_MAX_LINES = 6;
/**
 * Where the unsent question of a campaign is kept in this browser (Story 2.4); from Story 3.10 one per conversation:
 * `<campaign>:<conversation>`, or `<campaign>:new:<area>` before a new conversation has its id.
 */
export const DRAFT_PREFIX = 'gmshield:draft:';

/** The key of a conversation's draft after {@link DRAFT_PREFIX} (Story 3.10). */
export function draftKey(campaignId: string, conversationId: string | null, area: Area): string {
  return conversationId === null ? `${campaignId}:new:${area}` : `${campaignId}:${conversationId}`;
}

/** The three example questions of each area (Story 3.10), by their message keys. */
const EXAMPLES = ['one', 'two', 'three'] as const;
/** `EventSource.CLOSED`, without reading the browser global. */
const CLOSED = 2;

/** Story 2.6: the first wait before the page reopens a stream the browser gave up, doubling up to the longest. */
export const REOPEN_FIRST_MS = 1000;
export const REOPEN_LONGEST_MS = 15_000;
/** Story 2.6: how long a lost connection may go without an `open` before the page stops trying. */
export const RECONNECT_GIVE_UP_MS = 120_000;
/** Story 3.11: how long the "Resposta dispensada." line with "Desfazer" stays in a dismissed turn's place. */
export const UNDO_MS = 10_000;

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
 * Story 3.11: whether a turn is shown, dismissed with its undo line in its place, or dismissed for good. A dismissed
 * turn stays in the page's state (behind this flag), so the count of the questions asked here still works.
 */
type Dismissal = 'shown' | 'undoable' | 'gone';

/**
 * A turn asked since the page opened: its question, then its answer as it is written. Story 2.5: its citations as they
 * arrive, and once it is done its references, or `silent` when it has none. Story 2.6: how it failed, and its stream's
 * connection. Story 2.7: its id once known, which names its references to the source view. Story 3.7: its tier events
 * as they arrive (each tier's version of the answer starts at its offset). Story 3.8: whether its model knowledge was
 * on, as frozen with it (from its `done` event), which decides the offer under a silent answer. Story 3.11: whether the GM
 * dismissed it, why its dismissal was refused (shown under its actions), why its undo was (shown in its line), and
 * whether its undo is under way. Story 3.12: whether its answer is saved, and why the last change of that was refused
 * (shown under its actions).
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
  readonly modelKnowledge: boolean;
  readonly failure: Failure | null;
  readonly connection: Connection;
  readonly dismissal: Dismissal;
  readonly dismissProblem: unknown;
  readonly undoProblem: unknown;
  readonly undoPending: boolean;
  readonly bookmarked: boolean;
  readonly bookmarkProblem: unknown;
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

/**
 * The superscripts of a finished answer: each citation whose passage is in a place's reference, with its number; from
 * Story 4.3 part C each citation of a record that has a reference, with that record entry's number. A record's
 * reference also lists its passages, but a passage's citation is marked only by a place's reference.
 */
function marksOf(turn: ShownTurn): CitationMark[] {
  const passages = new Map<string, number>();
  const records = new Map<string, number>();
  for (const reference of turn.references) {
    if (isRecordReference(reference)) {
      records.set(reference.recordId, reference.number);
      continue;
    }
    for (const passageId of reference.passageIds) {
      if (!passages.has(passageId)) {
        passages.set(passageId, reference.number);
      }
    }
  }
  return turn.citations.flatMap((citation) => {
    const number = citation.recordId === undefined ? passages.get(citation.passageId) : records.get(citation.recordId);
    return number === undefined ? [] : [{ offset: citation.offset, number }];
  });
}

/**
 * Story 3.7: the tier pills of a finished answer, each with its word in the interface's language. A pill of the scope's
 * tiers says the sources disagree, so the markers are tidied first: in text order, one whose tier repeats the one before
 * it is dropped, and none of campaign, system and other is drawn unless at least two of them are left. Story 3.8: the
 * model's own knowledge is always drawn, even alone, with its sentence (`tierSpoken`), and ends where the next marker
 * kept starts, or at the answer's end.
 */
function tierMarksOf(starts: readonly TierStart[], t: Translate): TierMark[] {
  const ordered = [...starts].sort((one, other) => one.offset - other.offset);
  const kept = ordered.filter((start, index) => index === 0 || start.tier !== ordered[index - 1]?.tier);
  const scoped = new Set(kept.filter((start) => start.tier !== MODEL_TIER).map((start) => start.tier));
  return kept.flatMap((start, index): TierMark[] => {
    const label = tierWord(start.tier, t);
    const spoken = tierSpoken(start.tier, t);
    if (spoken === null) {
      return scoped.size < 2 ? [] : [{ offset: start.offset, tier: start.tier, label }];
    }
    const next = kept[index + 1];
    return [{ offset: start.offset, tier: start.tier, label, spoken, ...(next === undefined ? {} : { end: next.offset }) }];
  });
}

/** The turn's language when the interface has it, else the interface's. */
function languageOf(turnLanguage: string | null, fallback: Language): Language {
  return turnLanguage === 'pt-BR' || turnLanguage === 'en' ? turnLanguage : fallback;
}

export type ConversationProps = {
  readonly language: Language;
  readonly campaignId: string;
  readonly hasSources: boolean;
  /** Story 3.10: the sidebar's area the conversation belongs to (Consultas by default). */
  readonly area?: Area;
  /** Story 3.10: the conversation opened; absent or null for a new one, which gets its id from its first question. */
  readonly conversationId?: string | null;
  /** Story 3.10: the opened conversation's name. */
  readonly name?: string | null;
  /** Story 3.10: the opened conversation's stored turns, oldest first, each with its events. */
  readonly stored?: readonly StoredTurn[];
  /**
   * Story 3.10 part B: how many questions the opened conversation held when the page read it; absent or null when it
   * was not read (a conversation made on this page, or a count that could not be read).
   */
  readonly questions?: number | null;
  /** Story 3.10 part B: the Server Action behind "Excluir"; without it the conversation offers no delete. */
  readonly deleteAction?: (previous: ConversationDeleteState, form: FormData) => Promise<ConversationDeleteState>;
  /** The newest material that needs review, when there is one. */
  readonly review: { readonly href: string; readonly name: string } | null;
  /** For tests: how a stream of a turn is opened (the browser's `EventSource` by default). */
  readonly openStream?: (url: string) => EventSource;
  /** For tests: how the source view reads a page (the relay by default). */
  readonly loadPage?: LoadPage;
  /**
   * Story 3.12: the turn a saved item's "Ir" opens the conversation at (`?turn=`): it is scrolled into view instead of
   * the last turn, and takes focus. One not among the turns loaded leaves the conversation at its last turn.
   */
  readonly focusTurn?: string | null;
};

/**
 * The reference open in the source view (Story 2.7): its turn's id, the reference, and how many times a reference was
 * opened, so selecting the open reference again reopens it at its cited page.
 */
type OpenSource = { readonly turnId: string; readonly reference: SourceReference; readonly opened: number };

function readDraft(key: string): string {
  try {
    return globalThis.localStorage?.getItem(`${DRAFT_PREFIX}${key}`) ?? '';
  } catch {
    return '';
  }
}

function writeDraft(key: string, text: string): void {
  try {
    if (text === '') {
      globalThis.localStorage?.removeItem(`${DRAFT_PREFIX}${key}`);
    } else {
      globalThis.localStorage?.setItem(`${DRAFT_PREFIX}${key}`, text);
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
    modelKnowledge: false,
    failure: null,
    connection: 'open',
    dismissal: 'shown',
    dismissProblem: null,
    undoProblem: null,
    undoPending: false,
    bookmarked: false,
    bookmarkProblem: null,
  };
}

/** What a stored turn whose answer is still being written resumes from (Story 3.10): its stream after its last event. */
type Resume = {
  readonly key: number;
  readonly turnId: string;
  readonly language: string | null;
  readonly question: string;
  readonly initial: FollowStart;
};

/** Where a stream starts: the text, citations and tiers already received, and the last event id (Story 3.10). */
type FollowStart = {
  readonly text: string;
  readonly citations: readonly Citation[];
  readonly tiers: readonly TierStart[];
  readonly lastId: string | null;
};

/** The data of a stored event, as an object; null when it is not one. */
function storedData(data: unknown): Record<string, unknown> | null {
  return typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
}

/**
 * A stored turn as the screen shows it (Story 3.10), its events folded as the stream's would be: deltas make its text,
 * citations and tiers are kept, and its last event ends it (done: finished or stopped, with its references; error: its
 * failure). One with no final event is still being written: it shows what it has and is followed from its last event.
 */
export function shownFromStored(stored: StoredTurn, key: number): { readonly turn: ShownTurn; readonly resume: Resume | null } {
  let text = '';
  const citations: Citation[] = [];
  const tiers: TierStart[] = [];
  let lastId: string | null = null;
  const base = { ...newTurn(key, stored.question), id: stored.id, language: stored.language ?? null, bookmarked: stored.bookmarked === true };
  for (const event of stored.events) {
    lastId = String(event.sequence);
    const data = storedData(event.data);
    switch (event.type) {
      case 'delta':
        text += typeof data?.text === 'string' ? data.text : '';
        break;
      case 'citation': {
        const citation = parseCitation(data);
        if (citation !== null) {
          citations.push(citation);
        }
        break;
      }
      case 'tier': {
        const start = parseTier(data);
        if (start !== null) {
          tiers.push(start);
        }
        break;
      }
      case 'done': {
        const done = parseDone(data, tiers.some((start) => start.tier === MODEL_TIER));
        const turn: ShownTurn = {
          ...base,
          status: done.stopped ? 'stopped' : 'done',
          text,
          citations,
          tiers,
          references: done.references,
          silent: done.silent,
          modelKnowledge: done.modelKnowledge,
        };
        return { turn, resume: null };
      }
      case 'error': {
        const code = typeof data?.code === 'string' ? data.code : null;
        return { turn: { ...base, status: 'failed', text, failure: failureOf(code), problem: { code, category: null } }, resume: null };
      }
      default:
        break;
    }
  }
  const turn: ShownTurn = { ...base, status: text === '' ? 'searching' : 'answering', text };
  return { turn, resume: { key, turnId: stored.id, language: base.language, question: stored.question, initial: { text, citations, tiers, lastId } } };
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
export function NoCampaignConversation({ language, area = 'questions' }: { readonly language: Language; readonly area?: Area }) {
  const t = translator(language);
  // Story 3.10: named after its area.
  const heading = t(`shell.entries.${area}`);
  return (
    <section className={styles.conversation} aria-label={heading}>
      <h1 className={styles.visuallyHidden}>{heading}</h1>
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
 * The conversation screen (Story 2.4): the conversation's turns, and the composer.
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
 * - Story 3.8: a part from the model's own knowledge opens with the "Conhecimento do modelo" pill (drawn even alone) and
 *   closes with a muted "Do conhecimento do modelo, sem fonte."; such an answer is not silent. Under a silent answer
 *   whose turn had model knowledge off, a muted line offers to widen the sources or turn model knowledge on, with
 *   "Abrir o escopo", which opens the context bar's scope popover with focus inside it.
 * - Story 3.10, conversations by area: a slim line at the top leads back to the area's list ("← Consultas" or "← Criação
 *   de Regras") and, once the conversation has an id, shows its name and "Renomear". A new conversation shows its
 *   area's heading and three example questions (each fills the composer and focuses it; none is sent), with the cursor
 *   in the composer; its first question is asked in its area, and the conversation id that comes back replaces the
 *   address with `/{area}/{id}` without leaving the page. An opened conversation shows its stored turns as their events
 *   fold (answers with their superscripts and references, stopped and failed ones marked), follows one still being
 *   written from its last event, and every question continues it. The draft is kept per conversation.
 * - Story 3.10 part B: once the conversation has an id, "Excluir" follows "Renomear" in the top line; its dialog names
 *   how many questions go (the count read with the page, plus those asked on it since), or says so in words when no
 *   count was read (a conversation made on this page).
 * - Story 3.11, dismiss an answer: under the rule of each finished or stopped answer, right-aligned, a filled circle
 *   with an X ("Dispensar resposta"); none while an answer is written, nor on a failed turn. Selecting it replaces the
 *   question and answer at once with "Resposta dispensada." and a "Desfazer" pill, which takes focus while the polite
 *   region says the line; the dismissal is sent. "Desfazer" within {@link UNDO_MS} undoes it: the turn shows again where
 *   it was, with focus on its dismiss button. After that the line goes (focus on its pill moves to the composer). A
 *   refused dismissal brings the answer back with the refusal under its actions; a refused undo keeps the line, with
 *   the refusal in it, until its time ends. While an undo is under way the line's time does not end it: the undo's
 *   answer does (shown again, or, refused after the time, the line goes then). The delete dialog's count leaves out the
 *   turns dismissed here, and a conversation whose every turn is gone shows its intro again.
 * - Story 3.12, bookmark an answer: before dismiss, under each done answer only (not a stopped, failed, running or
 *   silent one),
 *   a filled circle with an outlined bookmark ("Salvar resposta"); once saved, an outlined circle with a filled bookmark
 *   ("Remover dos itens salvos"), with `aria-pressed`. A press changes it at once, then sends the change; a refusal puts
 *   it back and shows its text under the actions. The saved items panel, when open, reads its list again. Each turn's
 *   `<li>` is `turn-<id>`, and a conversation opened at a turn (`focusTurn`, a saved item's "Ir") shows that one instead
 *   of the last, with focus on it; a turn not loaded leaves it at the last turn.
 */
export function Conversation({
  language,
  campaignId,
  hasSources,
  review,
  openStream,
  loadPage,
  area = 'questions',
  conversationId = null,
  name = null,
  stored = [],
  questions = null,
  deleteAction,
  focusTurn = null,
}: ConversationProps) {
  const t = translator(language);
  const savedItems = useSavedItems();
  const uploads = useUploads();
  const scopePopover = useOptionalScopePopover();
  const [draft, setDraft] = useState('');
  // Story 3.10: the stored turns of an opened conversation, folded once; those still being written are followed below.
  const [opening] = useState(() => stored.map((turn, index) => shownFromStored(turn, index + 1)));
  const [turns, setTurns] = useState<readonly ShownTurn[]>(() => opening.map((shown) => shown.turn));
  /** Story 3.10: the conversation, once it has an id (an opened one, or a new one after its first question). */
  const [conversation, setConversation] = useState<{ readonly id: string; readonly name: string } | null>(
    conversationId === null ? null : { id: conversationId, name: name ?? '' },
  );
  const conversationRef = useRef<string | null>(conversationId);
  const key = draftKey(campaignId, conversation?.id ?? null, area);
  const composer = useRef<HTMLTextAreaElement | null>(null);
  const [spoken, setSpoken] = useState<Spoken>({ text: '', answer: false, references: [], note: '', tiers: [] });
  const [alerted, setAlerted] = useState('');
  const counter = useRef(stored.length);
  const followers = useRef(new Map<number, Follower>());
  /** The ids of the turns asked, by key, as soon as they are known; and the keys whose stop waits for one. */
  const turnIds = useRef(new Map<number, string>());
  const pendingStops = useRef(new Set<number>());
  /** Story 2.7: the reference open in the source view, the button that opened it, and whether focus goes back to it. */
  const [source, setSource] = useState<OpenSource | null>(null);
  const sourceOpener = useRef<HTMLButtonElement | null>(null);
  const focusOpener = useRef(false);
  const openings = useRef(0);
  /**
   * Story 3.11: each dismissed turn's undo timer and pending dismissal (an undo waits for it, so it never overtakes it),
   * the undos under way, the dismiss buttons and undo pills by turn key, and where focus goes after the next render.
   */
  const undoTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismissals = useRef(new Map<number, Promise<boolean>>());
  const undoing = useRef(new Set<number>());
  /** Story 3.11: the turns whose line's time ended while their undo was under way: the undo's answer settles them. */
  const lapsed = useRef(new Set<number>());
  const dismissButtons = useRef(new Map<number, HTMLButtonElement>());
  const undoButtons = useRef(new Map<number, HTMLButtonElement>());
  const pendingFocus = useRef<{ readonly key: number; readonly to: 'undo' | 'dismiss' } | 'composer' | null>(null);
  /**
   * Story 3.12: each turn's bookmark changes, sent one after the other (so the last press is the one that holds), and
   * the number of the latest press, whose refusal alone puts the button back.
   */
  const bookmarkQueue = useRef(new Map<number, Promise<void>>());
  const bookmarkPress = useRef(new Map<number, number>());

  useEffect(() => {
    // Read after the first render, so the server's and the browser's first renders agree.
    let current = true;
    void Promise.resolve().then(() => {
      const kept = readDraft(key);
      if (current && kept !== '') {
        setDraft((typed) => (typed === '' ? kept : typed));
      }
    });
    return () => {
      current = false;
    };
  }, [key]);

  // Story 3.10: a new conversation opens with the cursor in the composer.
  useEffect(() => {
    if (stored.length === 0) {
      composer.current?.focus();
    }
    // Only when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const open = followers.current;
    const timers = undoTimers.current;
    return () => {
      for (const follower of open.values()) {
        follower.close();
      }
      open.clear();
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
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
        writeDraft(key, question);
        return question;
      });
    },
    [key],
  );

  const follow = useCallback(
    (key: number, turnId: string, turnLanguage: string | null, question: string, initial?: FollowStart) => {
      const open = openStream ?? ((url: string) => new EventSource(url));
      // Story 3.10: a stored turn still being written resumes after what it already has.
      let text = initial?.text ?? '';
      const citations: Citation[] = [...(initial?.citations ?? [])];
      const tiers: TierStart[] = [...(initial?.tiers ?? [])];
      let lastId: string | null = initial?.lastId ?? null;
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
          // Story 3.8: a part marked as the model's own knowledge is not silent, even with no reference.
          const done = parseDone(dataOf(event), tiers.some((start) => start.tier === MODEL_TIER));
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
              modelKnowledge: done.modelKnowledge,
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
            modelKnowledge: done.modelKnowledge,
          }));
          if (done.silent) {
            const turnT = translator(languageOf(turnLanguage, language));
            // Story 3.8: with model knowledge off, the offer under it is said too, in the same language.
            say(done.modelKnowledge ? turnT('conversation.silent') : `${turnT('conversation.silent')} ${turnT('conversation.offer')}.`);
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

  /** Story 3.11: whether focus is on the undo pill of the turn `key`. */
  const onUndoPill = useCallback((key: number) => {
    const pill = undoButtons.current.get(key);
    return pill !== undefined && pill === document.activeElement;
  }, []);

  /** Story 3.11: ends a turn's undo timer, if it runs. */
  const stopUndoTimer = useCallback((key: number) => {
    clearTimeout(undoTimers.current.get(key));
    undoTimers.current.delete(key);
  }, []);

  /** Story 3.11: the undo line of the turn `key` goes; focus on its pill moves to the composer. */
  const endLine = useCallback(
    (key: number) => {
      if (onUndoPill(key)) {
        pendingFocus.current = 'composer';
      }
      change(key, (turn) => (turn.dismissal === 'undoable' ? { ...turn, dismissal: 'gone', undoProblem: null } : turn));
    },
    [change, onUndoPill],
  );

  /**
   * Story 3.11: dismisses the turn `key` at once (its undo line in its place, with focus on "Desfazer"), starts the
   * line's time, and sends the dismissal; a refusal brings the turn back with its text under the actions.
   */
  const dismiss = useCallback(
    (key: number, turnId: string) => {
      pendingFocus.current = { key, to: 'undo' };
      change(key, (turn) => ({ ...turn, dismissal: 'undoable', dismissProblem: null, undoProblem: null }));
      say(t('conversation.dismissed'));
      stopUndoTimer(key);
      undoTimers.current.set(
        key,
        setTimeout(() => {
          undoTimers.current.delete(key);
          // An undo under way decides: its success shows the turn again, its refusal ends the line then.
          if (undoing.current.has(key)) {
            lapsed.current.add(key);
          } else {
            endLine(key);
          }
        }, UNDO_MS),
      );
      const sent = setDismissal(turnId, 'dismiss').then((result) => {
        if (result.ok) {
          // Story 3.12: a dismissed saved answer leaves the saved items.
          savedItems?.savedChanged();
        } else {
          stopUndoTimer(key);
          if (onUndoPill(key)) {
            pendingFocus.current = { key, to: 'dismiss' };
          }
          change(key, (turn) => ({ ...turn, dismissal: 'shown', dismissProblem: result.problem, undoProblem: null }));
          say(errorText(result.problem, language));
        }
        return result.ok;
      });
      dismissals.current.set(key, sent);
    },
    [change, endLine, language, onUndoPill, savedItems, say, stopUndoTimer, t],
  );

  /**
   * Story 3.11: "Desfazer": once the dismissal was recorded, undoes it; the turn shows again where it was, with focus on
   * its dismiss button. A refused undo keeps the line, with its text, until the line's time ends; refused after that
   * time (which waited for it), the line goes at once.
   */
  const undo = useCallback(
    async (key: number, turnId: string) => {
      if (undoing.current.has(key)) {
        return;
      }
      undoing.current.add(key);
      change(key, (turn) => ({ ...turn, undoPending: true }));
      try {
        // A refused dismissal has brought the turn back already.
        if (!(await (dismissals.current.get(key) ?? Promise.resolve(true)))) {
          return;
        }
        const result = await setDismissal(turnId, 'restore');
        if (result.ok) {
          // Story 3.12: an undone dismissal of a saved answer lists it again.
          savedItems?.savedChanged();
          stopUndoTimer(key);
          lapsed.current.delete(key);
          dismissals.current.delete(key);
          pendingFocus.current = { key, to: 'dismiss' };
          change(key, (turn) => ({ ...turn, dismissal: 'shown', dismissProblem: null, undoProblem: null }));
          return;
        }
        say(errorText(result.problem, language));
        if (lapsed.current.delete(key)) {
          // Its time ended while the undo was under way: the line goes now, as it would have then.
          endLine(key);
        } else {
          change(key, (turn) => (turn.dismissal === 'undoable' ? { ...turn, undoProblem: result.problem } : turn));
        }
      } finally {
        undoing.current.delete(key);
        lapsed.current.delete(key);
        change(key, (turn) => (turn.undoPending ? { ...turn, undoPending: false } : turn));
      }
    },
    [change, endLine, language, savedItems, say, stopUndoTimer],
  );

  /**
   * Story 3.12: saves the answer of the turn `key`, or removes it from the saved items. The button changes at once, then
   * the change is sent (after any still under way for that turn); a refusal of the latest press puts the button back
   * and says why under the actions. The saved items panel, when open, reads its list again.
   */
  const toggleBookmark = useCallback(
    (key: number, turnId: string, wanted: boolean) => {
      const press = (bookmarkPress.current.get(key) ?? 0) + 1;
      bookmarkPress.current.set(key, press);
      change(key, (turn) => ({ ...turn, bookmarked: wanted, bookmarkProblem: null }));
      const before = bookmarkQueue.current.get(key) ?? Promise.resolve();
      const sent = before.then(async () => {
        const result = await setBookmark(turnId, wanted ? 'save' : 'remove');
        const latest = bookmarkPress.current.get(key) === press;
        if (result.ok) {
          savedItems?.savedChanged();
        } else if (latest) {
          change(key, (turn) => ({ ...turn, bookmarked: !wanted, bookmarkProblem: result.problem }));
          say(errorText(result.problem, language));
        }
      });
      bookmarkQueue.current.set(key, sent);
    },
    [change, language, say, savedItems],
  );

  // Story 3.11: focus goes where a dismissal, its undo or the end of its line sent it, once the screen shows it.
  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) {
      return;
    }
    pendingFocus.current = null;
    if (target === 'composer') {
      composer.current?.focus();
    } else {
      (target.to === 'undo' ? undoButtons : dismissButtons).current.get(target.key)?.focus();
    }
  }, [turns]);

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
      const known = conversationRef.current;
      const asked = await postQuestion(campaignId, question, known === null ? { area } : { conversationId: known });
      if (!asked.ok) {
        pendingStops.current.delete(key);
        // A refused question is not lost: it goes back to the composer unless the GM has started another.
        restore(question);
        change(key, (turn) => ({ ...turn, status: 'failed', problem: asked.problem }));
        say(errorText(asked.problem, language));
        return;
      }
      turnIds.current.set(key, asked.turn.id);
      if (conversationRef.current === null) {
        // Story 3.10: the first question made the conversation; the address becomes its own, without leaving the page.
        const id = asked.turn.conversationId;
        conversationRef.current = id;
        setConversation({ id, name: defaultName(question) });
        globalThis.history?.replaceState(null, '', `/${area}/${encodeURIComponent(id)}`);
      }
      change(key, (turn) => ({ ...turn, id: asked.turn.id, status: 'searching', language: asked.turn.language }));
      say(t('conversation.answering'));
      follow(key, asked.turn.id, asked.turn.language, question);
      if (pendingStops.current.delete(key)) {
        void sendStop(key, asked.turn.id);
      }
    },
    [area, campaignId, change, follow, language, restore, say, sendStop, t],
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
  // Story 3.10: an opened conversation shows its last turn at once, without the smooth scroll of a new question.
  // Story 3.12: opened at a turn (a saved item's "Ir"), it shows that turn instead, with focus on it, when it is among
  // the turns loaded; otherwise its last turn, as before.
  const lastTurn = useRef<HTMLLIElement | null>(null);
  const shownTurns = useRef(0);
  const opened = useRef(stored.length > 0);
  useEffect(() => {
    if (turns.length > shownTurns.current) {
      const opening = opened.current;
      const still = opening || (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      opened.current = false;
      const target = opening && focusTurn !== null ? document.getElementById(`turn-${focusTurn}`) : null;
      if (target === null) {
        lastTurn.current?.scrollIntoView?.({ block: 'start', behavior: still ? 'auto' : 'smooth' });
      } else {
        showTurn(target);
      }
    }
    shownTurns.current = turns.length;
    // Only the count of turns moves the page; the turn to open at is read once, when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns.length]);

  // Story 3.10: a stored turn whose answer is still being written is followed from its last event.
  useEffect(() => {
    for (const { resume } of opening) {
      if (resume !== null) {
        turnIds.current.set(resume.key, resume.turnId);
        follow(resume.key, resume.turnId, resume.language, resume.question, resume.initial);
      }
    }
    // Once, when the screen opens: the followers' own effect closes them when it leaves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  /** Story 3.12: another right panel (the saved items) took the slot: the source view closes, and focus stays there. */
  const replaceSource = useCallback(() => {
    focusOpener.current = false;
    sourceOpener.current = null;
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
    writeDraft(key, '');
    await ask(question);
  }, [ask, key, draft, running]);

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

  /** Story 3.10: an example question fills the composer and puts the cursor after it; it is never sent. */
  const chooseExample = (example: string) => {
    setDraft(example);
    writeDraft(key, example);
    const field = composer.current;
    if (field !== null) {
      field.value = example;
      field.focus();
      field.setSelectionRange(example.length, example.length);
    }
  };

  const linkText = (text: string, address: string) => t('conversation.link', { text, address });
  const areaName = t(`shell.entries.${area}`);
  const title = conversation !== null && conversation.name !== '' ? conversation.name : areaName;
  const lines = Math.min(COMPOSER_MAX_LINES, Math.max(1, draft.split('\n').length));
  // Story 3.10 part B: the questions read with the page, plus those the backend recorded on it since.
  const askedHere = turns.slice(stored.length).filter((turn) => turn.id !== null).length;
  // Story 3.11: less the turns dismissed here, which the backend no longer counts (nor deletes in words).
  const dismissedHere = turns.filter((turn) => turn.dismissal !== 'shown').length;
  const questionCount = questions === null ? null : Math.max(0, questions + askedHere - dismissedHere);

  // 2026-11-23: the questions shown, in order, for the timeline at the right.
  const timeline = turns.filter((turn) => turn.dismissal === 'shown').map((turn) => ({ key: turn.key, question: turn.question }));

  return (
    <section className={styles.conversation} aria-label={title}>
      <h1 className={styles.visuallyHidden}>{title}</h1>
      {/* Story 3.10: the way back to the area's list and, once the conversation has an id, its name, "Renomear" and "Excluir". */}
      <div className={styles.top} data-testid="conversation-top">
        <Link className={styles.back} href={`/${area}`}>
          <NamedIcon name="back" size={16} />
          {areaName}
        </Link>
        {conversation === null ? null : (
          <>
            <p className={styles.name}>{conversation.name}</p>
            <PillLink href={`/${area}/${encodeURIComponent(conversation.id)}/edit`}>{t('conversation.rename')}</PillLink>
            {deleteAction === undefined ? null : (
              <ConversationDeleteAction id={conversation.id} questions={questionCount} language={language} action={deleteAction} />
            )}
          </>
        )}
      </div>
      {/* Story 3.11: a conversation whose every turn was dismissed here shows the intro, as it would on a reload. */}
      {turns.every((turn) => turn.dismissal === 'gone') ? (
        <div className={styles.intro} data-testid="conversation-intro">
          <span className={styles.introIcon}>
            <NamedIcon name={area} size={28} />
          </span>
          <p className={styles.introTitle}>{t(area === 'rules' ? 'conversation.intro.rulesTitle' : 'conversation.intro.title')}</p>
          <p className={styles.introText}>{t(area === 'rules' ? 'conversation.intro.rulesText' : 'conversation.intro.text')}</p>
          <ul className={styles.examples} aria-label={t('conversation.intro.examples')}>
            {EXAMPLES.map((example) => {
              const text = t(`conversation.examples.${area}.${example}`);
              return (
                <li key={example}>
                  <button type="button" className={styles.example} onClick={() => chooseExample(text)}>
                    {text}
                  </button>
                </li>
              );
            })}
          </ul>
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
          const last = index === turns.length - 1 ? lastTurn : undefined;
          if (turn.dismissal === 'gone') {
            return null;
          }
          if (turn.dismissal === 'undoable') {
            // Story 3.11: the dismissed turn's place, for its undo's time.
            return (
              <li key={turn.key} className={styles.dismissedTurn} ref={last} data-testid="dismissed-line">
                <p className={styles.dismissedLine}>
                  <span>{t('conversation.dismissed')}</span>
                  {turnId === null ? null : (
                    <PillButton
                      ref={(button) => {
                        if (button === null) {
                          undoButtons.current.delete(turn.key);
                        } else {
                          undoButtons.current.set(turn.key, button);
                        }
                      }}
                      pending={turn.undoPending}
                      onClick={() => void undo(turn.key, turnId)}
                    >
                      {t('conversation.undo')}
                    </PillButton>
                  )}
                </p>
                {turn.undoProblem === null ? null : (
                  <p className={styles.dismissedLine} data-testid="undo-problem">
                    {errorText(turn.undoProblem, language)}
                  </p>
                )}
              </li>
            );
          }
          const target = turnId !== null && turnId === focusTurn;
          return (
            <li
              key={turn.key}
              id={turnId === null ? undefined : `turn-${turnId}`}
              className={styles.turn}
              data-turn-key={turn.key}
              ref={last}
              // Story 3.12: the turn a saved item opened takes focus once, from the page; never from the keyboard.
              tabIndex={target ? -1 : undefined}
            >
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
              {silent && !turn.modelKnowledge ? (
                <p className={styles.offer} data-testid="silent-offer">
                  <span>{t('conversation.offer')}</span>
                  {scopePopover?.available === true ? (
                    <button type="button" className={styles.offerAction} onClick={scopePopover.open}>
                      {t('conversation.openScope')}
                    </button>
                  ) : null}
                </p>
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
              {/* Story 3.11: the answer's actions, right-aligned under its rule; Story 3.12: bookmark (done answers only), then dismiss. */}
              {finished && turnId !== null ? (
                <div className={styles.actions}>
                  {/* A silent answer (the sources said nothing) is not saved (Story 3.12 review). */}
                  {turn.status === 'done' && !turn.silent ? (
                    <button
                      type="button"
                      className={styles.action}
                      aria-label={t(turn.bookmarked ? 'conversation.unbookmark' : 'conversation.bookmark')}
                      aria-pressed={turn.bookmarked}
                      data-set={turn.bookmarked ? 'true' : undefined}
                      onClick={() => toggleBookmark(turn.key, turnId, !turn.bookmarked)}
                    >
                      <span className={styles.actionCircle}>
                        <NamedIcon name={turn.bookmarked ? 'bookmarkFilled' : 'bookmark'} size={16} />
                      </span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={styles.action}
                    aria-label={t('conversation.dismiss')}
                    ref={(button) => {
                      if (button === null) {
                        dismissButtons.current.delete(turn.key);
                      } else {
                        dismissButtons.current.set(turn.key, button);
                      }
                    }}
                    onClick={() => dismiss(turn.key, turnId)}
                  >
                    <span className={styles.actionCircle}>
                      <NamedIcon name="dismiss" size={16} />
                    </span>
                  </button>
                </div>
              ) : null}
              {turn.dismissProblem === null ? null : (
                <p className={styles.failed} data-testid="dismiss-problem">
                  {errorText(turn.dismissProblem, language)}
                </p>
              )}
              {turn.bookmarkProblem === null ? null : (
                <p className={styles.failed} data-testid="bookmark-problem">
                  {errorText(turn.bookmarkProblem, language)}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <ConversationTimeline items={timeline} label={t('conversation.timeline')} />
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
            ref={composer}
            id="conversation-question"
            className={styles.field}
            rows={lines}
            value={draft}
            placeholder={t('conversation.composer.placeholder')}
            maxLength={4000}
            onChange={(event) => {
              setDraft(event.target.value);
              writeDraft(key, event.target.value);
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
                {isRecordReference(reference) ? `${recordHeading(reference, t)}. ` : null}
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
        <ShellPanel onReplaced={replaceSource}>
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
