import { PageHeader } from '@/components/PageHeader';
import { notFoundFor } from '@/app/not-found';
import { Notice } from '@/components/Notice';
import { SystemForm } from '@/components/SystemForm';
import { errorText, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { getSystem } from '@/server/library';
import { currentSessionToken } from '@/server/session-cookies';

import { changeSystemAction } from '../../actions';

/**
 * A system's edit page (Story 3.1): the form with the system's values and the version they were read at; saving opens
 * the system's page. Another owner's id, an unknown one or a malformed one shows the single "Não encontrado." page.
 */
export default async function EditSystemPage({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const [{ id }, { language }, token] = await Promise.all([params, currentPreferences(), currentSessionToken()]);
  const t = translator(language);
  const system = await getSystem(token ?? '', id);
  if (!system.ok) {
    notFoundFor(system.problem);
    return <Notice status="danger" language={language} message={errorText(system.problem, language)} dismissible={false} />;
  }
  const { name, edition, description, version } = system.data;
  const page = `/systems/${encodeURIComponent(system.data.id)}`;
  return (
    <>
      <PageHeader title={t('systems.form.editTitle')} back={{ href: page, label: name }} />
      <SystemForm
        labels={{
          name: t('systems.form.name'),
          edition: t('systems.form.edition'),
          description: t('systems.form.description'),
          submit: t('systems.form.save'),
          cancel: t('systems.form.cancel'),
        }}
        initial={{ values: { name, edition: edition ?? '', description: description ?? '' }, version, error: null, field: null, stale: false }}
        id={system.data.id}
        cancelHref={page}
        action={changeSystemAction}
      />
    </>
  );
}
