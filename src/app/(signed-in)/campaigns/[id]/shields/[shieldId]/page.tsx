import type { Metadata } from 'next';

import { notFoundFor } from '@/app/not-found';
import { Notice } from '@/components/Notice';
import { EmptyState, PageHeader } from '@/components/PageHeader';
import { PillLink } from '@/components/PillLink';
import { ShieldDeleteAction } from '@/components/ShieldDeleteAction';
import { errorText, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { currentSessionToken } from '@/server/session-cookies';
import { getShield, shieldDeletion } from '@/server/shields';

import { shieldName } from '../../../rows';
import { deleteShieldAction } from '../actions';

type Props = { readonly params: Promise<{ readonly id: string; readonly shieldId: string }> };

/** The page's title: the Shield's name ("Escudo do Mestre" for an unnamed first one), else "Escudos". */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ id, shieldId }, { language }, token] = await Promise.all([params, currentPreferences(), currentSessionToken()]);
  const t = translator(language);
  const shield = await getShield(token ?? '', id, shieldId);
  return { title: shield.ok ? shieldName(shield.data, t) : t('campaigns.page.shields') };
}

/**
 * A Shield's screen (Story 6.1): its name as the title ("Escudo do Mestre" / "GM's Shield" while it is the campaign's
 * unnamed first Shield), the way back to the campaign's Shields tab, and "Renomear" (its rename page); then, until notes
 * (6.2) and dice (6.3) live here, one sentence: "Este escudo ainda não tem notas.". Part B: "Excluir" comes last in the
 * header ({@link ShieldDeleteAction}), with the deletion preview read with the Shield (its counts, and whether it is the
 * campaign's only Shield, which it then refuses without a dialog). Another owner's Shield, one of another
 * campaign or of a campaign being deleted, an unknown one or a malformed one shows the single "Não encontrado." page;
 * another failure is a notice.
 */
export default async function ShieldPage({ params }: Props) {
  const [{ id, shieldId }, { language }, token] = await Promise.all([params, currentPreferences(), currentSessionToken()]);
  const t = translator(language);
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const [shield, deletion] = await Promise.all([getShield(token ?? '', id, shieldId), shieldDeletion(token ?? '', id, shieldId)]);
  if (!shield.ok) {
    notFoundFor(shield.problem);
    return <Notice status="danger" language={language} message={errorText(shield.problem, language)} dismissible={false} />;
  }
  const campaignPath = `/campaigns/${encodeURIComponent(id)}`;
  return (
    <>
      <PageHeader
        title={shieldName(shield.data, t)}
        back={{ href: `${campaignPath}?tab=shields`, label: t('campaigns.page.shields') }}
        actions={
          <>
            <PillLink href={`${campaignPath}/shields/${encodeURIComponent(shield.data.id)}/edit`}>{t('shields.rename')}</PillLink>
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
      <EmptyState icon="shield" text={t('shields.empty')} />
    </>
  );
}
