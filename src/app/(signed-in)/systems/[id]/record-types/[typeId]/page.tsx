import { notFoundFor } from '@/app/not-found';
import { ItemList } from '@/components/ItemList';
import { Notice } from '@/components/Notice';
import { EmptyState, PageHeader } from '@/components/PageHeader';
import { errorText, translator } from '@/messages';
import { pageParam } from '@/paging';
import { currentPreferences, currentViews } from '@/preferences';
import { getRecordType, getSystem, listRecords } from '@/server/library';
import { listPage } from '@/server/list-page';
import { currentSessionToken } from '@/server/session-cookies';

import { recordRow, recordTypeName } from '../../../rows';

/**
 * A record type's records (Story 4.3), opened from a row of the system's records tab: the type's name as the title,
 * the system's name as the way back to its records tab, then the records of the system's accepted materials,
 * alphabetical by name, a page at a time (`?page=`), with the "Exibição" menu. Each row shows the record's name, with
 * the material it was read from and its first page as the detail, and opens the record's page. Two records with one
 * name (a spell split across two batches) are two rows, as they were extracted. A type with no record says in one
 * sentence where records come from, with no action. Another owner's system or record type, an unknown one or a
 * malformed one shows the single "Não encontrado." page; another failure is a notice.
 */
export default async function RecordTypePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string; readonly typeId: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [{ id, typeId }, query, { language }, views, token] = await Promise.all([
    params,
    searchParams,
    currentPreferences(),
    currentViews(),
    currentSessionToken(),
  ]);
  const t = translator(language);
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const [system, type] = await Promise.all([getSystem(token ?? '', id), getRecordType(token ?? '', typeId)]);
  if (!system.ok || !type.ok) {
    const problem = system.ok ? (type.ok ? null : type.problem) : system.problem;
    notFoundFor(problem);
    return <Notice status="danger" language={language} message={errorText(problem, language)} dismissible={false} />;
  }
  const systemId = system.data.id;
  const here = `/systems/${encodeURIComponent(systemId)}/record-types/${encodeURIComponent(type.data.id)}`;
  const records = await listPage((ask) => listRecords(token ?? '', type.data.id, ask), pageParam(query.page), views.records.size);
  let body;
  if (!records.ok) {
    body = <Notice status="danger" language={language} message={errorText(records.problem, language)} dismissible={false} />;
  } else if (records.data.paging.total === 0) {
    body = <EmptyState icon="rules" text={t('systems.records.empty')} />;
  } else {
    body = (
      <ItemList
        label={t('systems.records.list')}
        rows={records.data.rows.map((record) => recordRow(record, t, systemId))}
        pages={{ paging: records.data.paging, path: here }}
        icon="rules"
        viewKey="records"
        view={views.records}
        language={language}
      />
    );
  }
  return (
    <>
      <PageHeader
        title={recordTypeName(type.data, t)}
        back={{ href: `/systems/${encodeURIComponent(systemId)}?tab=records`, label: system.data.name }}
      />
      {body}
    </>
  );
}
