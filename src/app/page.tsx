import { headers } from 'next/headers';

import { languageFor, messagesFor } from '@/messages';

export default async function HomePage() {
  const messages = messagesFor(languageFor((await headers()).get('accept-language')));
  return (
    <main>
      <h1>{messages.home.heading}</h1>
      <p>{messages.home.lead}</p>
    </main>
  );
}
