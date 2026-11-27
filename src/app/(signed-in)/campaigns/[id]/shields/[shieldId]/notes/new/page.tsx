import type { Metadata } from 'next';

import { notFoundFor } from '@/app/not-found';
import { NoteForm } from '@/components/NoteForm';
import { Notice } from '@/components/Notice';
import { PageHeader } from '@/components/PageHeader';
import { errorText, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { currentSessionToken } from '@/server/session-cookies';
import { getShield } from '@/server/shields';

import { shieldName } from '../../../../../rows';
import { createNoteAction } from '../../../actions';
import { NO_NOTE } from '../../../form-state';

/** The page's title: "Nova nota". */
export async function generateMetadata(): Promise<Metadata> {
  const { language } = await currentPreferences();
  return { title: translator(language)('shields.notes.form.title') };
}

/**
 * "Nova nota" (Story 6.2): the form as a page of the main column, under the way back to its Shield ({@link NoteForm}):
 * "Título" and "Texto", then "Salvar nota". Once it is saved, the note's artifact page opens with a toast. While the
 * browser has no connection the form says "Sem conexão" and keeps the text without sending it. Another owner's Shield,
 * one of another campaign or of a campaign being deleted, an unknown one or a malformed one shows the single "Não
 * encontrado." page; another failure is a notice.
 */
export default async function NewNotePage({
  params,
}: {
  readonly params: Promise<{ readonly id: string; readonly shieldId: string }>;
}) {
  const [{ id, shieldId }, { language }, token] = await Promise.all([params, currentPreferences(), currentSessionToken()]);
  const t = translator(language);
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const shield = await getShield(token ?? '', id, shieldId);
  if (!shield.ok) {
    notFoundFor(shield.problem);
    return <Notice status="danger" language={language} message={errorText(shield.problem, language)} dismissible={false} />;
  }
  const back = `/campaigns/${encodeURIComponent(id)}/shields/${encodeURIComponent(shield.data.id)}`;
  return (
    <>
      <PageHeader title={t('shields.notes.form.title')} back={{ href: back, label: shieldName(shield.data, t) }} />
      <NoteForm
        labels={{
          name: t('shields.notes.form.name'),
          content: t('shields.notes.form.content'),
          submit: t('shields.notes.form.save'),
          cancel: t('shields.notes.form.cancel'),
          offline: t('artifacts.edit.offline'),
        }}
        initial={NO_NOTE}
        campaignId={id}
        shieldId={shield.data.id}
        cancelHref={back}
        action={createNoteAction}
      />
    </>
  );
}
