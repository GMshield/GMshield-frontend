import { SystemForm } from '@/components/SystemForm';
import { translator } from '@/messages';
import { currentPreferences } from '@/preferences';

import { createSystemAction } from '../actions';
import { EMPTY_SYSTEM } from '../form-state';
import styles from '../systems.module.css';

/** "Novo sistema" (Story 3.1): the form as a page of the main column; the new system's page opens once it is saved. */
export default async function NewSystemPage() {
  const { language } = await currentPreferences();
  const t = translator(language);
  return (
    <>
      <div className={styles.header}>
        <h1 className={styles.heading}>{t('systems.form.newTitle')}</h1>
      </div>
      <SystemForm
        labels={{
          name: t('systems.form.name'),
          edition: t('systems.form.edition'),
          description: t('systems.form.description'),
          submit: t('systems.form.create'),
          cancel: t('systems.form.cancel'),
        }}
        initial={{ values: EMPTY_SYSTEM, version: null, error: null, field: null, stale: false }}
        cancelHref="/systems"
        action={createSystemAction}
      />
    </>
  );
}
