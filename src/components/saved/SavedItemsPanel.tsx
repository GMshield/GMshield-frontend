'use client';

import Link from 'next/link';
import { useActionState, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import type { CampaignActionState } from '@/app/(signed-in)/campaigns/form-state';
import { loadSavedAnswers, type SavedAnswer, type SavedPageResult } from '@/client/conversation';
import { errorText, translator, type Language, type Translate } from '@/messages';
import { pagingOf } from '@/paging';

import { CloseIcon } from '../Icons';
import { EmptyState } from '../PageHeader';
import { Pager } from '../Pager';
import { PillButton } from '../PillButton';
import pillStyles from '../PillButton.module.css';
import { ShellPanel } from '../ShellPanel';

import { useSavedItems } from './SavedItems';
import styles from './SavedItems.module.css';

/** How many saved answers a page of the panel holds (Story 3.12, Dalton 2026-11-22). */
export const SAVED_PAGE_SIZE = 10;

/** How the panel reads a page of the saved answers: from `offset`, at most `limit` (the relay by default). */
export type LoadSaved = (offset: number, limit: number) => Promise<SavedPageResult>;

/** The Server Action behind an "Ir" that switches campaign first (`openSavedAnswerAction`). */
export type OpenSavedAction = (previous: CampaignActionState, form: FormData) => Promise<CampaignActionState>;

export type SavedItemsPanelProps = {
  readonly language: Language;
  readonly action: OpenSavedAction;
  /** For tests: how a page is read. */
  readonly load?: LoadSaved;
};

/**
 * The saved items panel (Story 3.12), in the shell's right panel slot while it is open: one right panel at a time, so
 * opening it closes the source view or a preview, and opening one of those closes it.
 */
export function SavedItemsPanel({ language, action, load = loadSavedAnswers }: SavedItemsPanelProps) {
  const saved = useSavedItems();
  if (saved === null || !saved.open) {
    return null;
  }
  return (
    <ShellPanel kind="saved" onReplaced={saved.dismiss}>
      <SavedItemsView
        language={language}
        action={action}
        load={load}
        version={saved.version}
        currentCampaignId={saved.currentCampaignId}
        onClose={saved.close}
        onGo={saved.went}
        onRefused={saved.cancelGo}
      />
    </ShellPanel>
  );
}

type Shown =
  | { readonly state: 'loading' }
  | { readonly state: 'loaded'; readonly items: readonly SavedAnswer[]; readonly total: number }
  | { readonly state: 'failed'; readonly problem: unknown };

/** The address of the answer's conversation, scrolled to it. */
function answerHref(item: SavedAnswer): string {
  return `/${item.area}/${encodeURIComponent(item.conversationId)}?turn=${encodeURIComponent(item.turnId)}`;
}

/**
 * The meta-line of an entry: "area › conversation", led by the campaign when it is not the current one ("A Coroa
 * Partida › Consultas › Magias").
 */
function breadcrumb(item: SavedAnswer, currentCampaignId: string | null, t: Translate): string {
  const parts = [t(`shell.entries.${item.area}`), item.conversationName];
  if (item.campaignId !== currentCampaignId) {
    parts.unshift(item.campaignName);
  }
  return parts.join(t('saved.separator'));
}

/**
 * The panel's content (Story 3.12): its title and close control, then the GM's saved answers across all their
 * campaigns, newest first, ten a page with a compact pager at its foot (the page is the panel's own, not the address's).
 * Each entry is its meta-line, its excerpt (three lines at most) and an "Ir" pill. With no saved answer, one sentence.
 * It reads its list again whenever a bookmark changes on the page. Esc closes it; focus starts on its close control.
 */
function SavedItemsView({
  language,
  action,
  load,
  version,
  currentCampaignId,
  onClose,
  onGo,
  onRefused,
}: {
  readonly language: Language;
  readonly action: OpenSavedAction;
  readonly load: LoadSaved;
  readonly version: number;
  readonly currentCampaignId: string | null;
  readonly onClose: () => void;
  readonly onGo: (later: boolean) => void;
  readonly onRefused: () => void;
}) {
  const t = translator(language);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [shown, setShown] = useState<Shown>({ state: 'loading' });

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    let current = true;
    void load((page - 1) * SAVED_PAGE_SIZE, SAVED_PAGE_SIZE).then((result) => {
      if (!current) {
        return;
      }
      if (!result.ok) {
        setShown({ state: 'failed', problem: result.problem });
      } else if (result.items.length === 0 && page > 1) {
        // The page emptied since (an answer removed elsewhere): the one before it.
        setPage((now) => Math.max(1, now - 1));
      } else {
        setShown({ state: 'loaded', items: result.items, total: result.total });
      }
    });
    return () => {
      current = false;
    };
  }, [load, page, version, attempt]);

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onClose();
    }
  }

  let body;
  if (shown.state === 'loading') {
    body = (
      <p className={styles.muted} role="status">
        {t('saved.loading')}
      </p>
    );
  } else if (shown.state === 'failed') {
    body = (
      <div className={styles.failed}>
        <p role="alert" className={styles.muted}>
          {errorText(shown.problem, language)}
        </p>
        <PillButton onClick={() => setAttempt((count) => count + 1)}>{t('saved.retry')}</PillButton>
      </div>
    );
  } else if (shown.total === 0) {
    body = <EmptyState icon="bookmark" text={t('saved.empty')} />;
  } else {
    body = (
      <>
        <ul className={styles.entries} aria-label={t('saved.list')}>
          {shown.items.map((item) => (
            <li key={item.turnId} className={styles.entry}>
              <p className={styles.meta}>{breadcrumb(item, currentCampaignId, t)}</p>
              <p className={styles.excerpt}>{item.excerpt}</p>
              {item.campaignId === currentCampaignId ? (
                <Link
                  href={answerHref(item)}
                  className={`${pillStyles.pill} ${styles.go}`}
                  aria-label={t('saved.goTo', { name: item.conversationName })}
                  onClick={() => onGo(false)}
                >
                  {t('saved.go')}
                </Link>
              ) : (
                <GoAcross item={item} action={action} t={t} onGo={() => onGo(true)} onRefused={onRefused} />
              )}
            </li>
          ))}
        </ul>
        <div className={styles.foot}>
          <Pager
            compact
            paging={pagingOf(shown.total, (page - 1) * SAVED_PAGE_SIZE, shown.items.length, SAVED_PAGE_SIZE)}
            onPage={setPage}
            language={language}
            label={t('saved.pages')}
          />
        </div>
      </>
    );
  }

  return (
    <dialog open className={styles.view} aria-labelledby={titleId} onKeyDown={onKeyDown} data-testid="saved-items">
      <header className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          {t('saved.title')}
        </h2>
        <button ref={closeRef} type="button" className={styles.close} aria-label={t('saved.close')} onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <div className={styles.body}>{body}</div>
    </dialog>
  );
}

/**
 * "Ir" on a saved answer of another campaign: a form whose Server Action makes that campaign current (a toast names
 * it) and opens the answer; its refusal shows under it.
 */
function GoAcross({
  item,
  action,
  t,
  onGo,
  onRefused,
}: {
  readonly item: SavedAnswer;
  readonly action: OpenSavedAction;
  readonly t: Translate;
  readonly onGo: () => void;
  readonly onRefused: () => void;
}) {
  // A refusal comes back (a success redirects): the panel no longer waits for a page to close on.
  const go: OpenSavedAction = async (previous, form) => {
    const next = await action(previous, form);
    if (next.error !== null) {
      onRefused();
    }
    return next;
  };
  const [state, formAction, pending] = useActionState(go, { error: null, done: 0 });
  return (
    <form action={formAction} className={styles.goForm} onSubmit={onGo}>
      <input type="hidden" name="id" value={item.campaignId} />
      <input type="hidden" name="conversationId" value={item.conversationId} />
      <input type="hidden" name="area" value={item.area} />
      <input type="hidden" name="turnId" value={item.turnId} />
      <PillButton type="submit" className={styles.go} pending={pending} aria-label={t('saved.goTo', { name: item.conversationName })}>
        {t('saved.go')}
      </PillButton>
      {state.error === null ? null : (
        <p className={styles.refused} role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
