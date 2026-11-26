import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { systemRecordTypes } from '@/app/(signed-in)/systems/rows';
import { notFoundFor } from '@/app/not-found';
import { ArtifactDeleteAction } from '@/components/ArtifactDeleteAction';
import { ArtifactEditor } from '@/components/ArtifactEditor';
import { ArtifactVersions, type ArtifactVersionRow } from '@/components/ArtifactVersions';
import { Notice } from '@/components/Notice';
import { PageHeader, PageSubtitle } from '@/components/PageHeader';
import { RecordFields } from '@/components/RecordFields';
import { uploadDay } from '@/dates';
import { errorText, translator, type Language, type Translate } from '@/messages';
import { pageParam } from '@/paging';
import { currentPreferences } from '@/preferences';
import { typeLabel } from '@/record-types';
import { artifactVersionsPage, getArtifact, type ArtifactVersionSummary } from '@/server/artifacts';
import { getCampaign } from '@/server/library';
import { currentSessionToken } from '@/server/session-cookies';

import { deleteArtifactAction, restoreArtifactAction, updateArtifactAction } from '../actions';
import styles from '../artifacts.module.css';
import { artifactBack, artifactEditorTexts, artifactTypeOptions, artifactVersionsTexts, fromOf, FROM_CHARACTERS } from '../texts';

type Query = Readonly<Record<string, string | string[] | undefined>>;

type Props = {
  readonly params: Promise<{ readonly id: string; readonly artifactId: string }>;
  readonly searchParams?: Promise<Query>;
};

/** How many versions a page of "Versões" holds. */
const VERSIONS_PAGE_SIZE = 10;
/** A version's number in the address (`?version=`): from 1, at most nine digits; anything else is ignored. */
const VERSION = /^[1-9]\d{0,8}$/;
/** `?via=versions`: the version was opened from the page's own "Versões", not from an answer's reference. */
const VIA_VERSIONS = 'versions';

/** The version the address asks for (`?version=`), or null for the newest. */
function versionOf(value: unknown): number | null {
  return typeof value === 'string' && VERSION.test(value) ? Number(value) : null;
}

/**
 * The address of the artifact's page, on version `version` (null: the newest), keeping where it was opened from and,
 * above 1, the page of "Versões" shown (`page`).
 */
function artifactHref(campaignId: string, artifactId: string, from: string | null, version: number | null, page = 1): string {
  const query = new URLSearchParams();
  if (from !== null) {
    query.set('from', from);
  }
  if (version !== null) {
    query.set('version', String(version));
    query.set('via', VIA_VERSIONS);
  }
  if (page > 1) {
    query.set('page', String(page));
  }
  const text = query.toString();
  return `/campaigns/${encodeURIComponent(campaignId)}/artifacts/${encodeURIComponent(artifactId)}${text === '' ? '' : `?${text}`}`;
}

/** A version's row: "Versão 2 · Espada de Kael · 26 de nov. de 2026". */
function versionLabel(version: ArtifactVersionSummary, t: Translate, language: Language): string {
  return t('artifacts.versions.row', { number: version.number, name: version.name, date: uploadDay(version.createdAt, language) });
}

/** The page's title: the artifact's name (of the version shown), else "Artefatos" when it cannot be read. */
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ id, artifactId }, query, { language }, token] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<Query>({}),
    currentPreferences(),
    currentSessionToken(),
  ]);
  const artifact = await getArtifact(token ?? '', id, artifactId, versionOf(query.version));
  return { title: artifact.ok ? artifact.data.name : translator(language)('campaigns.page.artifacts') };
}

/**
 * An artifact's page (Story 5.1): its name as the title, the way back to its campaign's artifacts tab (to "Personagens"
 * when it was opened from there, `from=characters`), and its record type as the subtitle (a core type by its
 * translation, an approved one by the name its system gives it); then its fields as a two-column list
 * ({@link RecordFields}, as a record's page reads, closed by a rule; none drawn without fields); then its content as
 * plain text, its line breaks kept (never raw HTML); then its sources, which for an artifact written by hand say there
 * are none. Another owner's artifact, one of another campaign, an unknown one or a malformed one shows the single "Não
 * encontrado." page; another failure is a notice.
 *
 * Story 5.2:
 * - The newest version's fields and content sit in {@link ArtifactEditor}: "Editar" edits the name, type, fields and
 *   content in place, and a save stores the next version ("Artefato atualizado." and "Vale a partir da próxima
 *   pergunta.").
 * - `?version=N` (a positive number; anything else is ignored) shows that version read-only, as a reference that cited
 *   it opens it: a notice says which version is shown ("citada numa resposta", or only its number when it was opened
 *   from "Versões", `via=versions`) with a link to the newest, and there is no editor. A number the artifact does not
 *   have is "Não encontrado.". The newest version's number leads to the page's own address (without `version`), so
 *   the editor always lives there and a save or restore, which reads the address again, shows the newest.
 * - "Versões" ({@link ArtifactVersions}) lists the versions newest first, paged (`?page=`): each row opens its version,
 *   the newest is tagged "atual", and the others have "Restaurar".
 *
 * Story 5.2 part B: "Excluir" in the header ({@link ArtifactDeleteAction}), on every version shown, deletes the artifact
 * after a confirmation that names it by its current name (read again on an earlier version's page), and lands on the
 * artifacts tab (or "Personagens", `from=characters`) with a toast.
 */
export default async function ArtifactPage({ params, searchParams }: Props) {
  const [{ id, artifactId }, query, { language }, token] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<Query>({}),
    currentPreferences(),
    currentSessionToken(),
  ]);
  const t = translator(language);
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const [artifact, campaign] = await Promise.all([
    getArtifact(token ?? '', id, artifactId, versionOf(query.version)),
    getCampaign(token ?? '', id),
  ]);
  if (!artifact.ok) {
    notFoundFor(artifact.problem);
    return <Notice status="danger" language={language} message={errorText(artifact.problem, language)} dismissible={false} />;
  }
  const { name, recordType, fields, content, version, currentVersion, campaignId } = artifact.data;
  const from = fromOf(query.from);
  const older = version !== currentVersion;
  if (!older && versionOf(query.version) !== null) {
    redirect(artifactHref(campaignId, artifact.data.id, from, null));
  }
  const versionsPage = pageParam(query.page);
  // The campaign was read beside the artifact: without it, the type is named by its key's translation or the key.
  const [types, versions, newest] = await Promise.all([
    campaign.ok ? systemRecordTypes(token ?? '', campaign.data.system.id) : [],
    artifactVersionsPage(token ?? '', campaignId, artifact.data.id, versionsPage, VERSIONS_PAGE_SIZE),
    // Story 5.2 part B: "Excluir" names the artifact by its current name, also on an earlier version's page.
    older ? getArtifact(token ?? '', campaignId, artifact.data.id) : null,
  ]);
  const currentName = newest?.ok ? newest.data.name : name;
  const shownFields = (
    <>
      <RecordFields fields={fields} t={t} />
      {content === null ? null : (
        <section className={styles.section} aria-labelledby="artifact-content">
          <h2 id="artifact-content" className={styles.heading}>
            {t('artifacts.page.content')}
          </h2>
          <p className={styles.content}>{content}</p>
        </section>
      )}
    </>
  );
  // Every page link of "Versões" keeps the version shown and where the page was opened from.
  const pageQuery: Record<string, string> = {};
  if (from !== null) {
    pageQuery.from = FROM_CHARACTERS;
  }
  if (older) {
    pageQuery.version = String(version);
    if (query.via === VIA_VERSIONS) {
      pageQuery.via = VIA_VERSIONS;
    }
  }
  const rows: ArtifactVersionRow[] = versions.ok
    ? versions.data.rows.map((row) => ({
        number: row.number,
        label: versionLabel(row, t, language),
        href: artifactHref(campaignId, artifact.data.id, from, row.number === currentVersion ? null : row.number, versionsPage),
        current: row.number === currentVersion,
        shown: row.number === version,
      }))
    : [];
  return (
    <>
      <PageHeader
        title={name}
        back={artifactBack(campaignId, from, t)}
        actions={
          <ArtifactDeleteAction
            campaignId={campaignId}
            artifactId={artifact.data.id}
            name={currentName}
            from={from}
            language={language}
            action={deleteArtifactAction}
          />
        }
      >
        <PageSubtitle>{typeLabel(recordType, types, t)}</PageSubtitle>
      </PageHeader>
      {older ? (
        <>
          <Notice
            status="warning"
            language={language}
            message={t(query.via === VIA_VERSIONS ? 'artifacts.page.olderVersion' : 'artifacts.page.citedVersion', { version })}
            link={{ href: artifactHref(campaignId, artifact.data.id, from, null), label: t('artifacts.versions.viewCurrent') }}
            dismissible={false}
          />
          {shownFields}
        </>
      ) : (
        <ArtifactEditor
          campaignId={campaignId}
          artifactId={artifact.data.id}
          version={version}
          values={{ recordType, name, fields, content: content ?? '' }}
          types={artifactTypeOptions(types, t)}
          texts={artifactEditorTexts(t)}
          action={updateArtifactAction}
        >
          {shownFields}
        </ArtifactEditor>
      )}
      <section className={styles.section} aria-labelledby="artifact-sources">
        <h2 id="artifact-sources" className={styles.heading}>
          {t('artifacts.page.sources')}
        </h2>
        <p className={styles.none}>{t('artifacts.page.noSources')}</p>
      </section>
      {versions.ok ? (
        <ArtifactVersions
          campaignId={campaignId}
          artifactId={artifact.data.id}
          currentVersion={currentVersion}
          rows={rows}
          pages={{
            paging: versions.data.paging,
            path: `/campaigns/${encodeURIComponent(campaignId)}/artifacts/${encodeURIComponent(artifact.data.id)}`,
            query: pageQuery,
          }}
          older={older}
          from={from}
          texts={artifactVersionsTexts(t)}
          language={language}
          action={restoreArtifactAction}
        />
      ) : (
        <Notice status="danger" language={language} message={errorText(versions.problem, language)} dismissible={false} />
      )}
    </>
  );
}
