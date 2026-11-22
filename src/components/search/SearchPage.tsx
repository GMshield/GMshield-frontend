'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import type { Tier } from '@/client/conversation';
import { readSearch, startSearch, type Search, type SearchResult } from '@/client/search';
import { errorText, translator, type Language } from '@/messages';
import { pageOf } from '@/paging';

import { referenceLine } from '../conversation/References';
import { NamedIcon } from '../Icons';
import { Pager } from '../Pager';
import { Tabs } from '../PageHeader';
import { PillButton } from '../PillButton';
import { SCOPE_TIERS, scopeTiers, type Scope } from '../scope';
import { ShellPanel } from '../ShellPanel';
import { SourceView, type LoadScopePage } from '../SourceView';
import { TierLabel, tierWord } from '../TierLabel';
import { searchHref, searchQuery } from './search-address';
import styles from './SearchPage.module.css';

/** How often a pending search is read again, and for how long at most (Story 3.9). */
export const POLL_MS = 500;
export const POLL_LIMIT_MS = 30_000;
/** Results a page. */
export const RESULTS_PAGE = 10;
/** The longest query, in code points (the backend's `Scopes.MAX_QUERY`). */
export const MAX_QUERY = 500;

/** How the search's calls are made: this site's relays by default; tests give their own. */
export type SearchCalls = {
  readonly start: typeof startSearch;
  readonly read: typeof readSearch;
  readonly loadPage?: LoadScopePage;
  /** Waits before the next read of a pending search. */
  readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly now?: () => number;
};

export type SearchPageProps = {
  readonly language: Language;
  /** The current campaign: a search is of its scope. */
  readonly campaignId: string;
  /** The query in the address (`q`), or empty. */
  readonly query: string;
  /** The stored search in the address (`s`), or null until one is made. */
  readonly searchId: string | null;
  readonly tier: Tier | null;
  readonly materialId: string | null;
  /** The page of the results in the address, from 1. */
  readonly page: number;
  /** The campaign's scope settings, for the filters and the sentence of an empty search; null when unread. */
  readonly scope: Scope | null;
  readonly calls?: SearchCalls;
};

/** What the page shows under its field. */
type View =
  | { readonly kind: 'idle' }
  | { readonly kind: 'waiting' }
  | { readonly kind: 'done'; readonly search: Search }
  | { readonly kind: 'failed' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid'; readonly text: string }
  | { readonly kind: 'error'; readonly text: string };

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

const DEFAULT_CALLS: SearchCalls = { start: startSearch, read: readSearch };

/** Whether a query can be searched: 1 to 500 code points once trimmed. */
function searchable(query: string): boolean {
  const trimmed = query.trim();
  return trimmed !== '' && [...trimmed].length <= MAX_QUERY;
}

/** The result's place as a reference line: "Material, Section › Sub, p. N". */
function placeLine(result: SearchResult, t: ReturnType<typeof translator>): string {
  return referenceLine(
    { number: 0, materialName: result.materialName, sectionPath: result.sectionPath, page: result.page, passageIds: [], removed: false },
    t,
  );
}

/**
 * The search page's body (Story 3.9): its own field (prefilled with the query, at every width), the filters, and the
 * results of the stored search.
 *
 * - With a query and no stored search in the address, a search of the campaign's scope narrowed by the filters is
 *   started through the relay, and the address is replaced with its id (`&s=`), so a reload and a page turned read the
 *   stored search instead of searching again. A query the backend refuses (blank, past 500 code points) is said beside
 *   the field.
 * - A pending search is read again every 500 ms for up to 30 s; meanwhile a muted line says "Procurando nas fontes…".
 *   One that failed, or did not end in time, says so with "Tentar de novo", which starts it again.
 * - The results (up to 20) are paged ten at a time, the page in the address, with the shared pager. A row shows the
 *   passage's first words, its material › section and page, and its tier. Selecting it opens the source view at that
 *   page on the ground of the current scope, its passage marked; closing it gives focus back to the row.
 * - The tier chips cover only the tiers switched on; the material select only the materials switched on in them. A
 *   filter change starts a new, narrowed search from page 1: the backend narrows the scope, the page never hides rows.
 * - A search that found nothing says so in one sentence naming the scope searched.
 * - A search of another campaign (the GM switched since) is started again for the current one, and so is one that is
 *   gone (pruned, reached by Back or a bookmark) when the address has a query; with none, it is "Não encontrado.".
 * - A scope changed while a stored search is shown (a switch in the scope popover) reads it again, so a result now out
 *   of scope goes; the results shown stay until the new answer comes.
 */
export function SearchPage({ language, campaignId, query, searchId, tier, materialId, page, scope, calls = DEFAULT_CALLS }: SearchPageProps) {
  const t = useMemo(() => translator(language), [language]);
  const router = useRouter();
  const fieldId = useId();
  const errorId = useId();
  const [draft, setDraft] = useState(query);
  const [view, setView] = useState<View>(searchable(query) ? { kind: 'waiting' } : { kind: 'idle' });
  const [open, setOpen] = useState<{ readonly result: SearchResult; readonly opened: number } | null>(null);
  /** The search started for the address's query, filters and campaign: React may run an effect twice. */
  const started = useRef<string | null>(null);
  /**
   * The stored search whose final state is in hand, with the scope settings' version it was read under: turning its
   * pages reads it no more, but a scope changed since (a switch in the scope popover) reads it again.
   */
  const loaded = useRef<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const focusOpener = useRef(false);
  const openings = useRef(0);
  const { start, read, loadPage, wait = sleep, now = Date.now } = calls;

  // A new query in the address (the context bar's field, a link): the field shows it.
  const [addressQuery, setAddressQuery] = useState(query);
  if (addressQuery !== query) {
    setAddressQuery(query);
    setDraft(query);
  }

  /** Starts a search of the current query and filters; on success the address names it. */
  const begin = useCallback(async () => {
    const asked = query.trim();
    if (!searchable(asked)) {
      setView(asked === '' ? { kind: 'idle' } : { kind: 'invalid', text: t('search.invalid') });
      return;
    }
    setView({ kind: 'waiting' });
    setOpen(null);
    loaded.current = null;
    const answer = await start(campaignId, asked, { tier, materialId });
    if (answer.ok) {
      router.replace(searchHref({ query: asked, searchId: answer.id, tier, materialId }), { scroll: false });
    } else if (answer.status === 400) {
      setView({ kind: 'invalid', text: t('search.invalid') });
    } else {
      setView({ kind: 'error', text: errorText(answer.problem, language) });
    }
  }, [campaignId, language, materialId, query, router, start, t, tier]);

  // A query with no stored search: start one, once per query, filters and campaign.
  useEffect(() => {
    if (searchId !== null) {
      return;
    }
    const key = `${campaignId}\n${tier ?? ''}\n${materialId ?? ''}\n${query}`;
    if (started.current === key) {
      return;
    }
    started.current = key;
    void begin();
  }, [begin, campaignId, materialId, query, searchId, tier]);

  // A stored search: read it until it is done or failed, every 500 ms for up to 30 s; again when the scope changes,
  // the results shown staying until the new answer comes.
  const scopeVersion = scope?.version ?? null;
  useEffect(() => {
    const readKey = `${searchId}@${scopeVersion}`;
    if (searchId === null || loaded.current === readKey) {
      return undefined;
    }
    const controller = new AbortController();
    const until = now() + POLL_LIMIT_MS;
    setView((shown) => (shown.kind === 'done' && shown.search.id === searchId ? shown : { kind: 'waiting' }));
    void (async () => {
      for (;;) {
        const answer = await read(searchId, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        if (!answer.ok) {
          if (answer.status === 404 && searchable(query)) {
            // Gone (pruned after 20 newer searches, or reached by Back or a bookmark): search the query again.
            started.current = null;
            router.replace(searchHref({ query: query.trim(), tier, materialId }), { scroll: false });
            return;
          }
          setView(answer.status === 404 ? { kind: 'missing' } : { kind: 'error', text: errorText(answer.problem, language) });
          return;
        }
        const search = answer.search;
        if (search.campaignId !== campaignId) {
          // The GM switched campaign since: search the current one instead.
          started.current = null;
          router.replace(searchHref({ query, tier, materialId }), { scroll: false });
          return;
        }
        if (search.state === 'done') {
          loaded.current = readKey;
          setView({ kind: 'done', search });
          return;
        }
        if (search.state === 'failed') {
          loaded.current = readKey;
          setView({ kind: 'failed' });
          return;
        }
        if (now() >= until) {
          setView({ kind: 'timeout' });
          return;
        }
        await wait(POLL_MS, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
      }
    })();
    return () => controller.abort();
  }, [campaignId, language, materialId, now, query, read, router, scopeVersion, searchId, tier, wait]);

  // The source view closed: focus goes back to the row that opened it.
  useEffect(() => {
    if (open !== null || !focusOpener.current) {
      return;
    }
    focusOpener.current = false;
    const row = opener.current;
    opener.current = null;
    if (row?.isConnected) {
      row.focus();
    }
  }, [open]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const asked = draft.trim();
    if (!searchable(asked)) {
      setView({ kind: 'invalid', text: t('search.invalid') });
      return;
    }
    started.current = null;
    router.push(searchHref({ query: asked, tier, materialId }));
  }

  function onFieldKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      setDraft('');
    }
  }

  function retry() {
    started.current = null;
    void begin();
  }

  const onTiers = scope === null ? [] : SCOPE_TIERS.filter(({ key }) => scope[key]).map(({ tier: word }) => word);
  const materials =
    scope === null ? [] : scope.materials.filter((material) => material.on && onTiers.includes(material.tier) && (tier === null || material.tier === tier));
  const filtered = (next: { readonly tier: Tier | null; readonly materialId: string | null }) =>
    searchHref({ query: query.trim(), tier: next.tier, materialId: next.materialId });

  let body;
  switch (view.kind) {
    case 'idle':
      body = <p className={styles.muted}>{t('search.start')}</p>;
      break;
    case 'waiting':
      body = (
        <p className={styles.muted} role="status">
          {t('search.searching')}
        </p>
      );
      break;
    case 'missing':
      body = <p className={styles.muted}>{t('search.notFound')}</p>;
      break;
    case 'invalid':
      body = null;
      break;
    case 'failed':
    case 'timeout':
    case 'error':
      body = (
        <div className={styles.line} role="alert">
          <p className={styles.failedText}>
            {view.kind === 'error' ? view.text : t(view.kind === 'failed' ? 'search.failed' : 'search.timeout')}
          </p>
          <PillButton onClick={retry}>{t('search.retry')}</PillButton>
        </div>
      );
      break;
    case 'done':
      body = results(view.search);
      break;
  }

  /** A done search's results, a page at a time, or the sentence that says it found nothing. */
  function results(search: Search) {
    if (search.results.length === 0) {
      return <p className={styles.muted}>{t('search.empty', { query: search.query, scope: searchedScope() })}</p>;
    }
    const { rows, paging } = pageOf(search.results, page, RESULTS_PAGE);
    return (
      <>
        <ol className={styles.results} aria-label={t('search.results')} start={paging.from}>
          {rows.map((result) => (
            <li key={result.passageId} className={styles.result}>
              <button
                type="button"
                className={styles.row}
                aria-haspopup="dialog"
                data-open={open?.result.passageId === result.passageId ? 'true' : undefined}
                onClick={(event) => {
                  opener.current = event.currentTarget;
                  openings.current += 1;
                  setOpen({ result, opened: openings.current });
                }}
              >
                <span className={styles.words}>{result.firstWords}</span>
                <span className={styles.place}>
                  <TierLabel tier={result.tier} t={t} />
                  <span className={styles.placeLine}>{placeLine(result, t)}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <Pager paging={paging} path="/search" query={searchQuery({ query: search.query, searchId: search.id, tier, materialId })} language={language} />
      </>
    );
  }

  /** The scope a search searched, as the sentence of an empty one names it. */
  function searchedScope(): string {
    const tiers = scope === null ? null : scopeTiers(scope, t);
    const parts = [tier === null ? null : tierWord(tier, t), scope?.materials.find((material) => material.id === materialId)?.name ?? null].filter(
      (part): part is string => part !== null,
    );
    if (tiers === null) {
      return parts.join(', ');
    }
    return parts.length === 0 ? tiers : t('search.emptyFiltered', { scope: tiers, filter: parts.join(', ') });
  }

  const invalid = view.kind === 'invalid';
  return (
    <div className={styles.page}>
      <form role="search" className={styles.form} action="/search" aria-label={t('search.field')} onSubmit={submit}>
        <label className={styles.label} htmlFor={fieldId}>
          {t('search.field')}
        </label>
        <div className={styles.fieldRow}>
          <span className={styles.fieldIcon} aria-hidden="true">
            <NamedIcon name="search" size={18} />
          </span>
          <input
            id={fieldId}
            className={styles.input}
            type="search"
            name="q"
            value={draft}
            autoComplete="off"
            enterKeyHint="search"
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            data-search-field="page"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onFieldKeyDown}
          />
          {Object.entries(searchQuery({ query: '', tier, materialId })).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <PillButton type="submit" variant="solid" pending={view.kind === 'waiting'}>
            {t('search.submit')}
          </PillButton>
        </div>
        {invalid ? (
          <p id={errorId} className={styles.error}>
            {view.text}
          </p>
        ) : null}
      </form>
      {onTiers.length === 0 && materials.length === 0 ? null : (
        <div className={styles.toolbar}>
          <Tabs
            variant="chips"
            label={t('search.tiers')}
            tabs={[
              { key: 'all', href: filtered({ tier: null, materialId: null }), label: t('search.allTiers'), current: tier === null },
              ...onTiers.map((word) => ({
                key: word,
                href: filtered({ tier: word, materialId: null }),
                label: tierWord(word, t),
                current: tier === word,
              })),
            ]}
          />
          {materials.length === 0 ? null : (
            <label className={styles.materialField}>
              <span className={styles.materialLabel}>{t('search.material')}</span>
              <select
                className={styles.select}
                value={materialId ?? ''}
                onChange={(event) => router.push(filtered({ tier, materialId: event.target.value === '' ? null : event.target.value }))}
              >
                <option value="">{t('search.allMaterials')}</option>
                {materials.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {body}
      {open === null || view.kind !== 'done' ? null : (
        <ShellPanel>
          <SourceView
            key={`${open.result.passageId}:${open.opened}`}
            ground={{ kind: 'scope', campaignId: view.search.campaignId, versionId: open.result.versionId }}
            reference={{
              materialName: open.result.materialName,
              sectionPath: open.result.sectionPath,
              page: open.result.page,
              passageIds: [open.result.passageId],
            }}
            language={language}
            loadScope={loadPage}
            onClose={() => {
              focusOpener.current = true;
              setOpen(null);
            }}
          />
        </ShellPanel>
      )}
    </div>
  );
}
