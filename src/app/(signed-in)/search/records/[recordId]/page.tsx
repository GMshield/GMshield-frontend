import type { Metadata } from 'next';

import { correctRecordAction } from '@/app/(signed-in)/records/actions';
import { correctionTexts, typeOptions } from '@/app/(signed-in)/records/correction';
import { systemRecordTypes } from '@/app/(signed-in)/systems/rows';
import { notFoundFor } from '@/app/not-found';
import { Notice } from '@/components/Notice';
import { PageHeader, PageSubtitle } from '@/components/PageHeader';
import { RecordCorrection } from '@/components/RecordCorrection';
import { RecordFields } from '@/components/RecordFields';
import { RecordReferences } from '@/components/RecordReferences';
import { searchHref } from '@/components/search/search-address';
import { searchAddressOf, type SearchParams } from '@/components/search/search-params';
import { errorText, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { recordTypeName } from '@/record-types';
import { currentCampaign, getCampaignRecord } from '@/server/library';
import { currentSessionToken } from '@/server/session-cookies';

/** The page's title: the search's, until the record's name is known (a record's name is never in the address). */
export async function generateMetadata(): Promise<Metadata> {
  const { language } = await currentPreferences();
  return { title: translator(language)('search.title') };
}

type Props = {
  readonly params: Promise<{ readonly recordId: string }>;
  readonly searchParams?: Promise<SearchParams>;
};

/**
 * A record result's page (Story 4.3 part B): `/search/records/{id}?q=…&s=…&tier=…&material=…&type=…&page=…`, the record
 * as the current campaign shows it, read from `GET /api/v1/campaigns/{id}/records/{recordId}` (only a record of an
 * accepted version in the campaign's current scope, any tier). Its name is the title, its record type the subtitle,
 * then its fields (`RecordFields`, as part A's page draws them) and its source references, each of which opens the
 * source view at its page on the ground of the campaign's current scope, the record's passages there marked. The way
 * back is the search it was opened from, with its address (query, stored search, filters and page), labelled with the
 * search's title. A record outside the scope (switched off, not accepted, another account's, unknown or malformed), or
 * no current campaign, shows the single "Não encontrado." page; another failure is a notice. Story 4.5: "Corrigir" opens
 * the record's correction there too ({@link RecordCorrection}), its type among the campaign's system's record types.
 */
export default async function SearchRecordPage({ params, searchParams }: Props) {
  const [{ recordId }, query, { language }, token] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<SearchParams>({}),
    currentPreferences(),
    currentSessionToken(),
  ]);
  const t = translator(language);
  const back = { href: searchHref(searchAddressOf(query)), label: t('search.title') };
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const campaign = await currentCampaign(token ?? '');
  if (!campaign.ok) {
    notFoundFor(campaign.problem);
    return <Notice status="danger" language={language} message={errorText(campaign.problem, language)} dismissible={false} />;
  }
  const [record, types] = await Promise.all([
    getCampaignRecord(token ?? '', campaign.data.id, recordId),
    systemRecordTypes(token ?? '', campaign.data.system.id),
  ]);
  if (!record.ok) {
    notFoundFor(record.problem);
    return (
      <>
        <PageHeader title={t('search.title')} back={back} />
        <Notice status="danger" language={language} message={errorText(record.problem, language)} dismissible={false} />
      </>
    );
  }
  const { name, recordType, fields, references, version } = record.data;
  return (
    <>
      <PageHeader title={name} back={back}>
        <PageSubtitle>{recordTypeName(recordType, t)}</PageSubtitle>
      </PageHeader>
      <RecordCorrection
        ground={{ kind: 'campaign', campaignId: campaign.data.id }}
        recordId={record.data.id}
        version={version}
        values={{ name, recordType: recordType.key, fields }}
        types={typeOptions(types, recordType, t)}
        texts={correctionTexts(t)}
        action={correctRecordAction}
      >
        <RecordFields fields={fields} t={t} />
      </RecordCorrection>
      <RecordReferences ground={{ kind: 'scope', campaignId: campaign.data.id }} references={references} language={language} />
    </>
  );
}
