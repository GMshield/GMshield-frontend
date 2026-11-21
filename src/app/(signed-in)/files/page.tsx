import { AddFileButton } from '@/components/AddFileButton';
import { ItemList } from '@/components/ItemList';
import { Notice } from '@/components/Notice';
import { errorText, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { FILE_STATES, listMaterials } from '@/server/materials';
import { currentSessionToken } from '@/server/session-cookies';

import styles from '../systems/systems.module.css';

import { moreFiles } from './actions';
import { fileRow } from './rows';

/**
 * "Meus Arquivos" (Story 3.3): every material of the GM but a discarded one, newest first, in the shape of every list
 * page. "Adicionar Arquivo" is the one solid pill, and opens the guided upload. Each row names the material, its state,
 * its size, its pages and where it belongs ("Pronto · 1,2 MB · 320 páginas · Campanha X"), and opens its page. More
 * rows come with "Carregar mais", never on scrolling. An empty list says so in one sentence, with the one action; a
 * first page the backend left empty (every material on it was leaving) with a next page still offers "Carregar mais".
 * A list that cannot be loaded says why.
 */
export default async function FilesPage() {
  const [{ language }, token] = await Promise.all([currentPreferences(), currentSessionToken()]);
  const t = translator(language);
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const page = await listMaterials(token ?? '', FILE_STATES);
  return (
    <>
      <div className={styles.header}>
        <h1 className={styles.heading}>{t('shell.entries.files')}</h1>
        <AddFileButton label={t('shell.entries.addFile')} />
      </div>
      {!page.ok ? (
        <div className={styles.notice}>
          <Notice status="danger" language={language} message={errorText(page.problem, language)} dismissible={false} />
        </div>
      ) : page.data.items.length === 0 && page.data.nextCursor === undefined ? (
        <p className={styles.empty}>{t('files.empty')}</p>
      ) : (
        <ItemList
          // A new first page (another render in place) starts again without the rows added before.
          key={`${page.data.items[0]?.id ?? ''}:${page.data.nextCursor ?? ''}`}
          label={t('files.list')}
          rows={page.data.items.map((material) => fileRow(material, t, language))}
          nextCursor={page.data.nextCursor ?? null}
          loadMore={t('files.loadMore')}
          added={{ one: t('files.addedOne'), other: t('files.addedOther') }}
          action={moreFiles}
        />
      )}
    </>
  );
}
