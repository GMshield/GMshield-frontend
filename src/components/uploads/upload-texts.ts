import { errorText, messagesFor, type Language } from '@/messages';

import type { UploadTexts } from './types';

/**
 * The texts of the guided upload and the tray (Story 1.14), built on the server: the browser never receives a message
 * file, only these strings. Problem texts are resolved here for every known code and category, so the browser maps an
 * upload's problem without the message files.
 */
export function uploadTexts(language: Language): UploadTexts {
  const messages = messagesFor(language);
  const errors: Record<string, string> = {};
  for (const [category, reasons] of Object.entries(messages.errors.codes)) {
    errors[category] = errorText({ category }, language);
    for (const reason of Object.keys(reasons)) {
      const code = `${category}.${reason}`;
      errors[code] = errorText({ category, code }, language);
    }
  }
  return { language, upload: messages.upload, states: messages.material.state, pages: messages.material.pages, errors };
}
