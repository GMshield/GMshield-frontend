import type { Metadata } from 'next';

import { systemRecordTypes } from '@/app/(signed-in)/systems/rows';
import { notFoundFor } from '@/app/not-found';
import { Notice } from '@/components/Notice';
import { PageHeader, PageSubtitle } from '@/components/PageHeader';
import { RecordFields } from '@/components/RecordFields';
import { RecordReferences } from '@/components/RecordReferences';
import { RecordRelated } from '@/components/RecordRelated';
import { errorText, translator, type Translate } from '@/messages';
import { currentPreferences } from '@/preferences';
import { recordTypeName, typeLabel } from '@/record-types';
import { getCampaign, getCampaignRecord } from '@/server/library';
import { currentSessionToken } from '@/server/session-cookies';

import { FROM_ITEMS, fromOf } from '../../artifacts/texts';

type Query = Readonly<Record<string, string | string[] | undefined>>;

type Props = {
  readonly params: Promise<{ readonly id: string; readonly recordId: string }>;
  readonly searchParams?: Promise<Query>;
};

/** An artifact's id in the address (`?artifact=`): a UUID's text; anything else is ignored. */
const ID = /^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;

/** The page's title: the encyclopedia's, until the record's name is known (a record's name is never in the address). */
export async function generateMetadata(): Promise<Metadata> {
  const { language } = await currentPreferences();
  return { title: translator(language)('campaigns.page.items') };
}

/**
 * The way back of a campaign's record page (Story 7.2): to the artifact whose "Substituição" opened it (`artifact=`,
 * keeping where that artifact's page was opened from, `from=characters` or `from=items`), else to the campaign's item
 * encyclopedia tab, where its rows open it (`from=items`).
 */
function recordBack(campaignId: string, query: Query, t: Translate): { href: string; label: string } {
  const campaign = `/campaigns/${encodeURIComponent(campaignId)}`;
  const artifact = typeof query.artifact === 'string' && ID.test(query.artifact) ? query.artifact : null;
  if (artifact !== null) {
    const from = fromOf(query.from);
    return { href: `${campaign}/artifacts/${encodeURIComponent(artifact)}${from === null ? '' : `?from=${from}`}`, label: t('items.record.backArtifact') };
  }
  return { href: `${campaign}?tab=items`, label: t('campaigns.page.items') };
}

/**
 * A record as one campaign shows it (Story 7.2): `/campaigns/{id}/records/{recordId}`, read from
 * `GET /api/v1/campaigns/{id}/records/{recordId}` with the campaign of the address (not the current one), so a record
 * of the item encyclopedia, or the one an artifact overrides, opens in that campaign's context. Its name is the title,
 * its record type the subtitle, then its fields ({@link RecordFields}), the campaign's artifacts related to it
 * ({@link RecordRelated}, shown only when there is one) and its source references, each of which opens the source view
 * on the ground of that campaign's scope. The way back is the encyclopedia tab, or the artifact that opened it
 * ({@link recordBack}). A record outside the campaign's scope (switched off, not accepted, another account's, unknown
 * or malformed), or a campaign that is not the account's, shows the single "Não encontrado." page; another failure is
 * a notice. It changes nothing: correcting a record stays on its system's page and the search's.
 */
export default async function CampaignRecordPage({ params, searchParams }: Props) {
  const [{ id, recordId }, query, { language }, token] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<Query>({}),
    currentPreferences(),
    currentSessionToken(),
  ]);
  const t = translator(language);
  const back = recordBack(id, query, t);
  const fromItems = fromOf(query.from) === FROM_ITEMS;
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const record = await getCampaignRecord(token ?? '', id, recordId);
  if (!record.ok) {
    notFoundFor(record.problem);
    return (
      <>
        <PageHeader title={t('campaigns.page.items')} back={back} />
        <Notice status="danger" language={language} message={errorText(record.problem, language)} dismissible={false} />
      </>
    );
  }
  const { name, recordType, fields, references } = record.data;
  // The campaign's system's record types name the related artifacts' types (an approved one by its own name).
  const campaign = (record.data.related ?? []).length === 0 ? null : await getCampaign(token ?? '', id);
  const types = campaign?.ok ? await systemRecordTypes(token ?? '', campaign.data.system.id) : [];
  const related = (record.data.related ?? []).map((row) => ({
    artifactId: row.artifactId,
    // Opened from the encyclopedia, a related artifact's page leads back there too.
    href: `/campaigns/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(row.artifactId)}${fromItems ? `?from=${FROM_ITEMS}` : ''}`,
    name: row.name,
    typeLabel: typeLabel(row.recordType, types, t),
  }));
  return (
    <>
      <PageHeader title={name} back={back}>
        <PageSubtitle>{recordTypeName(recordType, t)}</PageSubtitle>
      </PageHeader>
      <RecordFields fields={fields} t={t} />
      <RecordRelated rows={related} heading={t('search.record.related')} label={t('search.record.relatedList')} />
      <RecordReferences ground={{ kind: 'scope', campaignId: id }} references={references} language={language} />
    </>
  );
}
