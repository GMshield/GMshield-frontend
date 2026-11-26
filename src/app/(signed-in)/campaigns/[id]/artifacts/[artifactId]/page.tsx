import type { Metadata } from 'next';

import { systemRecordTypes } from '@/app/(signed-in)/systems/rows';
import { notFoundFor } from '@/app/not-found';
import { Notice } from '@/components/Notice';
import { PageHeader, PageSubtitle } from '@/components/PageHeader';
import { RecordFields } from '@/components/RecordFields';
import { errorText, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { typeLabel } from '@/record-types';
import { getArtifact } from '@/server/artifacts';
import { getCampaign } from '@/server/library';
import { currentSessionToken } from '@/server/session-cookies';

import styles from '../artifacts.module.css';
import { artifactBack, fromOf } from '../texts';

type Props = {
  readonly params: Promise<{ readonly id: string; readonly artifactId: string }>;
  readonly searchParams?: Promise<Readonly<Record<string, string | string[] | undefined>>>;
};

/** The page's title: the artifact's name, else "Artefatos" when it cannot be read. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ id, artifactId }, { language }, token] = await Promise.all([params, currentPreferences(), currentSessionToken()]);
  const artifact = await getArtifact(token ?? '', id, artifactId);
  return { title: artifact.ok ? artifact.data.name : translator(language)('campaigns.page.artifacts') };
}

/**
 * An artifact's page (Story 5.1): its name as the title, the way back to its campaign's artifacts tab (to "Personagens"
 * when it was opened from there, `from=characters`), and its record
 * type as the subtitle (a core type by its translation, an approved one by the name its system gives it); then its
 * fields as a two-column list ({@link RecordFields}, as a record's page reads, closed by a rule; none drawn without
 * fields); then its content as plain text, its line breaks kept (never raw HTML); then its sources, which for an
 * artifact written by hand say there are none. Another owner's artifact, one of another campaign, an unknown one or a
 * malformed one shows the single "Não encontrado." page; another failure is a notice.
 */
export default async function ArtifactPage({ params, searchParams }: Props) {
  const [{ id, artifactId }, query, { language }, token] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<Readonly<Record<string, string | string[] | undefined>>>({}),
    currentPreferences(),
    currentSessionToken(),
  ]);
  const t = translator(language);
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const [artifact, campaign] = await Promise.all([getArtifact(token ?? '', id, artifactId), getCampaign(token ?? '', id)]);
  if (!artifact.ok) {
    notFoundFor(artifact.problem);
    return <Notice status="danger" language={language} message={errorText(artifact.problem, language)} dismissible={false} />;
  }
  const { name, recordType, fields, content } = artifact.data;
  // The campaign was read beside the artifact: without it, the type is named by its key's translation or the key.
  const types = campaign.ok ? await systemRecordTypes(token ?? '', campaign.data.system.id) : [];
  return (
    <>
      <PageHeader
        title={name}
        back={artifactBack(artifact.data.campaignId, fromOf(query.from), t)}
      >
        <PageSubtitle>{typeLabel(recordType, types, t)}</PageSubtitle>
      </PageHeader>
      <RecordFields fields={fields} t={t} />
      {content === null ? null : (
        <section className={styles.section} aria-labelledby="artifact-content">
          <h2 id="artifact-content" className={styles.heading}>
            {t('artifacts.page.content')}
          </h2>
          <p className={styles.content}>{content}</p>
        </section>
      )}
      <section className={styles.section} aria-labelledby="artifact-sources">
        <h2 id="artifact-sources" className={styles.heading}>
          {t('artifacts.page.sources')}
        </h2>
        <p className={styles.none}>{t('artifacts.page.noSources')}</p>
      </section>
    </>
  );
}
