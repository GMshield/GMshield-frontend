'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { parseCitation, parseDone, postQuestion, turnEventsUrl, type Citation, type SourceReference } from '@/client/conversation';
import { errorText, translator, type Language } from '@/messages';

import { useUploads } from '../uploads/UploadsProvider';

import { AnswerMarkdown, type CitationMark } from './AnswerMarkdown';
import styles from './Conversation.module.css';
import { References, referenceLine } from './References';

/** The most lines the composer grows to; past them it scrolls. */
export const COMPOSER_MAX_LINES = 6;
/** Where the unsent question of a campaign is kept in this browser (Story 2.4). */
export const DRAFT_PREFIX = 'gmshield:draft:';
/** `EventSource.CLOSED`, without reading the browser global. */
const CLOSED = 2;

type TurnStatus = 'sending' | 'searching' | 'answering' | 'done' | 'failed';

/**
 * A turn asked since the page opened: its question, then its answer as it is written. Story 2.5: its citations as they
 * arrive, and once it is done its references, or `silent` when it has none.
 */
type ShownTurn = {
  readonly key: number;
  readonly question: string;
  readonly status: TurnStatus;
  readonly language: string | null;
  readonly text: string;
  readonly problem: unknown;
  readonly citations: readonly Citation[];
  readonly references: readonly SourceReference[];
  readonly silent: boolean;
};

/** What the polite region says: plain words, or a finished answer (rendered) followed by its references as a list. */
type Spoken = { readonly text: string; readonly answer: boolean; readonly references: readonly SourceReference[] };

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
};

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

/**
 * The conversation screen (Story 2.4): the turns asked since the page opened, and the composer.
 *
 * - The composer is a pill: Enter sends, Shift+Enter adds a line, and it grows to six lines. Its draft is kept per
 *   campaign in this browser and cleared on send.
 * - A question shows at once, muted, with "Procurando nas fontes…"; its answer streams in as sanitized Markdown, in the
 *   answer size, with no bubble, card or avatar, closed by a rule. An answer in another language than the interface's
 *   is marked with its own (`lang` and a visible label).
 * - A polite live region says "Respondendo…" when the answer starts and the whole answer once it is done; an error event
 *   shows the generic text of its code.
 * - Story 2.5: once the answer is done, each citation whose passage is in a reference becomes an accent superscript with
 *   that reference's number, and the numbered references are listed under the answer, above the closing rule. A silent
 *   answer (no reference) replaces whatever streamed with the one "the sources say nothing" sentence, in the turn's
 *   language. Nothing of this shows while the answer streams. The polite region says the answer, then the references.
 * - With no accepted source, a line above the composer says so, with the guided upload and the newest material to
 *   review; asking still works.
 */
export function Conversation({ language, campaignId, hasSources, review, openStream }: ConversationProps) {
  const t = translator(language);
  const uploads = useUploads();
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<readonly ShownTurn[]>([]);
  const [spoken, setSpoken] = useState<Spoken>({ text: '', answer: false, references: [] });
  const counter = useRef(0);
  const streams = useRef(new Set<EventSource>());

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
    const open = streams.current;
    return () => {
      for (const stream of open) {
        stream.close();
      }
      open.clear();
    };
  }, []);

  /**
   * Says `text` politely; an answer is said as it reads, its Markdown rendered as on the screen, then its references as
   * a list.
   */
  const say = useCallback((text: string, answer = false, references: readonly SourceReference[] = []) => {
    // A zero-width space alternates so that the same words are said again.
    setSpoken((previous) => ({ text: previous.text === text ? `${text}\u200b` : text, answer, references }));
  }, []);

  const change = useCallback((key: number, update: (turn: ShownTurn) => ShownTurn) => {
    setTurns((all) => all.map((turn) => (turn.key === key ? update(turn) : turn)));
  }, []);

  const follow = useCallback(
    (key: number, turnId: string, turnLanguage: string | null) => {
      const stream = (openStream ?? ((url: string) => new EventSource(url)))(turnEventsUrl(turnId));
      streams.current.add(stream);
      let text = '';
      const citations: Citation[] = [];
      const end = () => {
        stream.close();
        streams.current.delete(stream);
      };
      stream.addEventListener('delta', (event) => {
        const data = dataOf(event);
        if (typeof data?.text === 'string') {
          text += data.text;
          const now = text;
          change(key, (turn) => ({ ...turn, status: 'answering', text: now }));
        }
      });
      stream.addEventListener('citation', (event) => {
        // Kept, not shown: the superscripts wait for the references the done event carries.
        const citation = parseCitation(dataOf(event));
        if (citation !== null) {
          citations.push(citation);
        }
      });
      stream.addEventListener('done', (event) => {
        end();
        const done = parseDone(dataOf(event));
        const kept = [...citations];
        change(key, (turn) => ({ ...turn, status: 'done', citations: kept, references: done.references, silent: done.silent }));
        if (done.silent) {
          say(translator(languageOf(turnLanguage, language))('conversation.silent'));
        } else {
          say(text, true, done.references);
        }
      });
      stream.addEventListener('error', (event) => {
        const data = dataOf(event);
        if (data === null) {
          // The connection itself: the browser reconnects from the last event id while the stream is open.
          if (stream.readyState !== CLOSED) {
            return;
          }
          end();
          const problem = { category: 'server', code: null };
          change(key, (turn) => ({ ...turn, status: 'failed', problem }));
          say(errorText(problem, language));
          return;
        }
        end();
        const problem = { code: typeof data.code === 'string' ? data.code : null, category: null };
        change(key, (turn) => ({ ...turn, status: 'failed', problem }));
        say(errorText(problem, language));
      });
    },
    [change, language, openStream, say],
  );

  const send = useCallback(async () => {
    const question = draft;
    if (question.trim() === '') {
      return;
    }
    counter.current += 1;
    const key = counter.current;
    setTurns((all) => [
      ...all,
      { key, question, status: 'sending', language: null, text: '', problem: null, citations: [], references: [], silent: false },
    ]);
    setDraft('');
    writeDraft(campaignId, '');
    const asked = await postQuestion(campaignId, question);
    if (!asked.ok) {
      // A refused question is not lost: it goes back to the composer unless the GM has started another.
      setDraft((typed) => {
        if (typed !== '') {
          return typed;
        }
        writeDraft(campaignId, question);
        return question;
      });
      change(key, (turn) => ({ ...turn, status: 'failed', problem: asked.problem }));
      say(errorText(asked.problem, language));
      return;
    }
    change(key, (turn) => ({ ...turn, status: 'searching', language: asked.turn.language }));
    say(t('conversation.answering'));
    follow(key, asked.turn.id, asked.turn.language);
  }, [campaignId, change, draft, follow, language, say, t]);

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
      <ol className={styles.turns} aria-label={t('conversation.turns')}>
        {turns.map((turn) => {
          const foreign = turn.language !== null && turn.language !== language;
          const languageName = turn.language === 'pt-BR' || turn.language === 'en' ? t(`conversation.languages.${turn.language}`) : turn.language;
          const finished = turn.status === 'done';
          const silent = finished && turn.silent;
          return (
            <li key={turn.key} className={styles.turn}>
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
              {silent || turn.text === '' ? null : (
                <div className={styles.answer} lang={foreign ? (turn.language ?? undefined) : undefined}>
                  {foreign ? <p className={styles.languageLabel}>{t('conversation.answerIn', { language: languageName ?? '' })}</p> : null}
                  <AnswerMarkdown
                    text={turn.text}
                    linkText={linkText}
                    marks={finished ? marksOf(turn) : []}
                    citationWord={translator(languageOf(turn.language, language))('conversation.citation')}
                  />
                </div>
              )}
              {finished && !silent && turn.references.length > 0 ? <References references={turn.references} t={t} /> : null}
              {turn.status === 'failed' ? <p className={styles.failed}>{errorText(turn.problem, language)}</p> : null}
              {turn.status === 'done' || turn.status === 'failed' ? <hr className={styles.rule} /> : null}
            </li>
          );
        })}
      </ol>
      <div className={styles.dock}>
        {hasSources ? null : (
          <p className={styles.empty} data-testid="conversation-empty">
            <span>{t('conversation.empty.noSources')}</span>
            <button type="button" className={styles.emptyAction} onClick={uploads.openUpload}>
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
          <button type="submit" className={styles.send} aria-label={t('conversation.composer.send')}>
            <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="24" height="24">
              <path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </form>
      </div>
      <div className={styles.visuallyHidden} aria-live="polite" data-testid="conversation-polite">
        {spoken.answer ? <AnswerMarkdown text={spoken.text} linkText={linkText} /> : spoken.text}
        {spoken.references.length === 0 ? null : (
          <ol aria-label={t('conversation.references')}>
            {spoken.references.map((reference) => (
              <li key={reference.number} value={reference.number}>
                {referenceLine(reference, t)}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
