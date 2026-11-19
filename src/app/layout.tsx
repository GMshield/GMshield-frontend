import '@fontsource-variable/dm-sans';
import './globals.css';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { messagesFor } from '@/messages';
import { currentPreferences } from '@/preferences';

// Story 2.4: on a phone the on-screen keyboard resizes the page, so the conversation's composer, pinned to the bottom
// of the column, stays above it.
export const viewport: Viewport = { width: 'device-width', initialScale: 1, interactiveWidget: 'resizes-content' };

export async function generateMetadata(): Promise<Metadata> {
  const messages = messagesFor((await currentPreferences()).language);
  return { title: messages.app.title, description: messages.app.description };
}

// The theme and language come from the cookies (src/preferences.ts), so the server renders the
// right theme and no client script can flash another. Reading the request also renders every page
// per request, which the nonce in the Content-Security-Policy (proxy.ts) needs.
export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { theme, language } = await currentPreferences();
  return (
    <html lang={language} data-theme={theme}>
      <body>{children}</body>
    </html>
  );
}
