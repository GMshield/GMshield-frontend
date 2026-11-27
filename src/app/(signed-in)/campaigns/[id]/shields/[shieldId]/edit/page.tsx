import type { Metadata } from 'next';

import { notFoundFor } from '@/app/not-found';
import { Notice } from '@/components/Notice';
import { PageHeader } from '@/components/PageHeader';
import { ShieldForm } from '@/components/ShieldForm';
import { errorText, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { currentSessionToken } from '@/server/session-cookies';
import { getShield } from '@/server/shields';

import { shieldName } from '../../../../rows';
import { renameShieldAction } from '../../actions';

/** The page's title: "Renomear escudo". */
export async function generateMetadata(): Promise<Metadata> {
  const { language } = await currentPreferences();
  return { title: translator(language)('shields.form.renameTitle') };
}

/**
 * A Shield's rename page (Story 6.1): the form with the Shield's stored name and the version it was read at; for the
 * unnamed first Shield the field starts empty, with "Escudo do Mestre" as its placeholder, so a save never stores the
 * default name in one language by accident; saving opens the Shield's screen with a toast. Another owner's Shield, one of
 * another campaign, an unknown one or a malformed one shows the single "Não encontrado." page.
 */
export default async function RenameShieldPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string; readonly shieldId: string }>;
}) {
  const [{ id, shieldId }, { language }, token] = await Promise.all([params, currentPreferences(), currentSessionToken()]);
  const t = translator(language);
  const shield = await getShield(token ?? '', id, shieldId);
  if (!shield.ok) {
    notFoundFor(shield.problem);
    return <Notice status="danger" language={language} message={errorText(shield.problem, language)} dismissible={false} />;
  }
  const shown = shieldName(shield.data, t);
  const screen = `/campaigns/${encodeURIComponent(id)}/shields/${encodeURIComponent(shield.data.id)}`;
  return (
    <>
      <PageHeader title={t('shields.form.renameTitle')} back={{ href: screen, label: shown }} />
      <ShieldForm
        labels={{
          name: t('shields.form.name'),
          submit: t('shields.form.save'),
          cancel: t('shields.form.cancel'),
          placeholder: t('shields.defaultName'),
        }}
        initial={{ values: { name: shield.data.name ?? '' }, version: shield.data.version, error: null, field: null, stale: false }}
        campaignId={id}
        id={shield.data.id}
        cancelHref={screen}
        action={renameShieldAction}
      />
    </>
  );
}
