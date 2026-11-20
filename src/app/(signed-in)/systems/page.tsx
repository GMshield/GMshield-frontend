import { ItemList } from '@/components/ItemList';
import { Notice } from '@/components/Notice';
import { PillLink } from '@/components/PillLink';
import { errorText, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { listSystems } from '@/server/library';
import { currentSessionToken } from '@/server/session-cookies';

import { moreSystems } from './actions';
import { systemRow } from './rows';
import styles from './systems.module.css';

/**
 * "Sistemas" (Story 3.1): the GM's systems, newest first, each row with its name and edition, opening the system's
 * page; "Novo sistema" is the one solid pill. More rows come with "Carregar mais", never on scrolling. With no system,
 * one sentence says what a system holds, and "Novo sistema" is the only action. A list that cannot be loaded says why.
 */
export default async function SystemsPage() {
  const [{ language }, token] = await Promise.all([currentPreferences(), currentSessionToken()]);
  const t = translator(language);
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const page = await listSystems(token ?? '');
  return (
    <>
      <div className={styles.header}>
        <h1 className={styles.heading}>{t('shell.entries.systems')}</h1>
        <PillLink href="/systems/new" solid>
          {t('systems.new')}
        </PillLink>
      </div>
      {!page.ok ? (
        <div className={styles.notice}>
          <Notice status="danger" language={language} message={errorText(page.problem, language)} dismissible={false} />
        </div>
      ) : page.data.items.length === 0 ? (
        <p className={styles.empty}>{t('systems.empty')}</p>
      ) : (
        <ItemList
          // A new first page (another render in place) starts again without the rows added before.
          key={`${page.data.items[0]?.id ?? ''}:${page.data.nextCursor ?? ''}`}
          label={t('systems.list')}
          rows={page.data.items.map(systemRow)}
          nextCursor={page.data.nextCursor ?? null}
          loadMore={t('systems.loadMore')}
          added={{ one: t('systems.addedOne'), other: t('systems.addedOther') }}
          action={moreSystems}
        />
      )}
    </>
  );
}
