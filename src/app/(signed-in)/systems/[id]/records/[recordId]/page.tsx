import { notFoundFor } from '@/app/not-found';
import { Notice } from '@/components/Notice';
import { PageHeader } from '@/components/PageHeader';
import { RecordFields } from '@/components/RecordFields';
import { RecordReferences } from '@/components/RecordReferences';
import { errorText, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { recordTypeName } from '@/record-types';
import { getRecord } from '@/server/library';
import { currentSessionToken } from '@/server/session-cookies';

/**
 * A record's page (Story 4.3), as its system shows it: its name as the title, under its record type, which is the way
 * back to that type's list; then its fields as a two-column list (the field's name in label type, its value in body
 * type, as a campaign's overview reads), in stored order and closed by a rule; then its source references, each of
 * which opens the source view at that page of the record's version ({@link RecordReferences}). A record without
 * fields shows no empty list and no rule. Records are read-only here (Story 4.5 corrects them). A record the system
 * does not show (another owner's, of a version that is not accepted or is superseded, of another system, unknown or
 * malformed) shows the single "Não encontrado." page; another failure is a notice.
 */
export default async function RecordPage({ params }: { readonly params: Promise<{ readonly id: string; readonly recordId: string }> }) {
  const [{ id, recordId }, { language }, token] = await Promise.all([params, currentPreferences(), currentSessionToken()]);
  const t = translator(language);
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const record = await getRecord(token ?? '', id, recordId);
  if (!record.ok) {
    notFoundFor(record.problem);
    return <Notice status="danger" language={language} message={errorText(record.problem, language)} dismissible={false} />;
  }
  const { name, recordType, fields, references } = record.data;
  const systemId = encodeURIComponent(id);
  return (
    <>
      <PageHeader title={name} back={{ href: `/systems/${systemId}/record-types/${encodeURIComponent(recordType.id)}`, label: recordTypeName(recordType, t) }} />
      <RecordFields fields={fields} t={t} />
      <RecordReferences ground={{ kind: 'record', systemId: id, recordId: record.data.id }} references={references} language={language} />
    </>
  );
}
