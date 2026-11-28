import { systemRecordTypes } from '@/app/(signed-in)/systems/rows';
import { notFoundFor } from '@/app/not-found';
import { ArtifactForm } from '@/components/ArtifactForm';
import { Notice } from '@/components/Notice';
import type { Metadata } from 'next';

import { PageHeader } from '@/components/PageHeader';
import { errorText, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { getCampaign } from '@/server/library';
import { currentSessionToken } from '@/server/session-cookies';

import { createArtifactAction } from '../actions';
import { artifactBack, artifactFormTexts, artifactTypeOptions, fromOf } from '../texts';

/** The page's title: "Novo artefato". */
export async function generateMetadata(): Promise<Metadata> {
  const { language } = await currentPreferences();
  return { title: translator(language)('artifacts.form.title') };
}

/** The type a new artifact starts with when the address names none, or one the system lacks. */
const DEFAULT_TYPE = 'note';

/**
 * "Novo artefato" (Story 5.1): the form as a page of the main column, under the way back to the campaign's artifacts
 * tab, or to "Personagens" (`from=characters`) or (Story 7.2) the item encyclopedia (`from=items`) when it was opened from there ({@link ArtifactForm}): the record type (one of the campaign's system's, core or approved; `?type=`
 * chooses it at the start, as "Nova ficha" does with `character_sheet`, else a note), the name, the fields and the
 * content. Once it is saved, the artifact's page opens. Another owner's campaign, an unknown one or a malformed one shows
 * the single "Não encontrado." page; another failure is a notice.
 */
export default async function NewArtifactPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [{ id }, query, { language }, token] = await Promise.all([params, searchParams, currentPreferences(), currentSessionToken()]);
  const t = translator(language);
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const campaign = await getCampaign(token ?? '', id);
  if (!campaign.ok) {
    notFoundFor(campaign.problem);
    return <Notice status="danger" language={language} message={errorText(campaign.problem, language)} dismissible={false} />;
  }
  const campaignId = campaign.data.id;
  // Opened from "Personagens" ("Nova ficha") or the item encyclopedia ("Novo artefato"), the way back and "Cancelar" lead
  // there, and so does the saved artifact.
  const from = fromOf(query.from);
  const back = artifactBack(campaignId, from, t);
  const types = artifactTypeOptions(await systemRecordTypes(token ?? '', campaign.data.system.id), t);
  const asked = typeof query.type === 'string' ? query.type : DEFAULT_TYPE;
  const chosen = types.find((type) => type.key === asked) ?? types.find((type) => type.key === DEFAULT_TYPE) ?? types[0];
  return (
    <>
      <PageHeader title={t('artifacts.form.title')} back={back} />
      <ArtifactForm
        campaignId={campaignId}
        types={types}
        texts={artifactFormTexts(t)}
        initial={{ serial: 0, values: { recordType: chosen?.key ?? DEFAULT_TYPE, name: '', fields: [], content: '' }, error: null, field: null }}
        from={from}
        cancelHref={back.href}
        action={createArtifactAction}
      />
    </>
  );
}
