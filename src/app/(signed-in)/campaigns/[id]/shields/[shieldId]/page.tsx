import type { Metadata } from 'next';

import { notFoundFor } from '@/app/not-found';
import { ItemList } from '@/components/ItemList';
import { Notice } from '@/components/Notice';
import { EmptyState, PageHeader } from '@/components/PageHeader';
import { PillLink } from '@/components/PillLink';
import { ShieldDeleteAction } from '@/components/ShieldDeleteAction';
import { errorText, translator } from '@/messages';
import { pageParam } from '@/paging';
import { currentPreferences, currentViews } from '@/preferences';
import { currentSessionToken } from '@/server/session-cookies';
import { getShield, shieldDeletion, shieldNotesPage } from '@/server/shields';

import { noteRow, shieldName } from '../../../rows';
import { deleteShieldAction } from '../actions';

type Props = {
  readonly params: Promise<{ readonly id: string; readonly shieldId: string }>;
  readonly searchParams?: Promise<Readonly<Record<string, string | string[] | undefined>>>;
};

/** The page's title: the Shield's name ("Escudo do Mestre" for an unnamed first one), else "Escudos". */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ id, shieldId }, { language }, token] = await Promise.all([params, currentPreferences(), currentSessionToken()]);
  const t = translator(language);
  const shield = await getShield(token ?? '', id, shieldId);
  return { title: shield.ok ? shieldName(shield.data, t) : t('campaigns.page.shields') };
}

/**
 * A Shield's screen (Story 6.1): its name as the title ("Escudo do Mestre" / "GM's Shield" while it is the campaign's
 * unnamed first Shield), the way back to the campaign's Shields tab, and "Renomear" (its rename page). Story 6.2: "Nova
 * nota" comes first in the header, the screen's solid pill, and opens the new note's page; below the header, the
 * Shield's notes, newest first, as a paged list (`?page=`, the "Exibição" menu's `notes` view), each row the note's
 * title linking to its artifact page; a Shield without notes says "Este escudo ainda não tem notas.". Part B: "Excluir" comes last in the
 * header ({@link ShieldDeleteAction}), with the deletion preview read with the Shield (its counts, and whether it is the
 * campaign's only Shield, which it then refuses without a dialog). Another owner's Shield, one of another
 * campaign or of a campaign being deleted, an unknown one or a malformed one shows the single "Não encontrado." page;
 * another failure is a notice.
 */
export default async function ShieldPage({ params, searchParams }: Props) {
  const [{ id, shieldId }, query, { language }, views, token] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<Readonly<Record<string, string | string[] | undefined>>>({}),
    currentPreferences(),
    currentViews(),
    currentSessionToken(),
  ]);
  const t = translator(language);
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const [shield, deletion, notes] = await Promise.all([
    getShield(token ?? '', id, shieldId),
    shieldDeletion(token ?? '', id, shieldId),
    shieldNotesPage(token ?? '', id, shieldId, pageParam(query.page), views.notes.size),
  ]);
  if (!shield.ok) {
    notFoundFor(shield.problem);
    return <Notice status="danger" language={language} message={errorText(shield.problem, language)} dismissible={false} />;
  }
  const campaignPath = `/campaigns/${encodeURIComponent(id)}`;
  const shieldPath = `${campaignPath}/shields/${encodeURIComponent(shield.data.id)}`;
  return (
    <>
      <PageHeader
        title={shieldName(shield.data, t)}
        back={{ href: `${campaignPath}?tab=shields`, label: t('campaigns.page.shields') }}
        actions={
          <>
            <PillLink href={`${shieldPath}/notes/new`} solid>
              {t('shields.notes.new')}
            </PillLink>
            <PillLink href={`${shieldPath}/edit`}>{t('shields.rename')}</PillLink>
            <ShieldDeleteAction
              key={`delete-${shield.data.id}`}
              campaignId={id}
              shieldId={shield.data.id}
              name={shieldName(shield.data, t)}
              deletion={deletion.ok ? deletion.data : null}
              language={language}
              action={deleteShieldAction}
            />
          </>
        }
      />
      {!notes.ok ? (
        <Notice status="danger" language={language} message={errorText(notes.problem, language)} dismissible={false} />
      ) : notes.data.paging.total === 0 ? (
        <EmptyState icon="shield" text={t('shields.empty')} />
      ) : (
        <ItemList
          label={t('shields.notes.list')}
          rows={notes.data.rows.map((note) => noteRow(note, campaignPath))}
          pages={{ paging: notes.data.paging, path: shieldPath, query: {} }}
          icon="file"
          viewKey="notes"
          view={views.notes}
          language={language}
        />
      )}
    </>
  );
}
