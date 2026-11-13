import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';

import { languageFor, messagesFor } from '@/messages';

async function currentLanguage() {
  return languageFor((await headers()).get('accept-language'));
}

export async function generateMetadata(): Promise<Metadata> {
  const messages = messagesFor(await currentLanguage());
  return { title: messages.app.title, description: messages.app.description };
}

// Reading the request headers renders every page per request, which the nonce in the
// Content-Security-Policy (proxy.ts) needs: Next.js puts it on its own inline scripts.
export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang={await currentLanguage()}>
      <body>{children}</body>
    </html>
  );
}
