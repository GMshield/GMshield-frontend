import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/** Story 2.4: under 768px the answer uses the body size, and the keyboard resizes the page so the composer stays above it. */
describe('the conversation on a phone', () => {
  it('sets the answer to the body size under 768px', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/conversation/Conversation.module.css'), 'utf8');
    const phone = /@media \(max-width: 767px\) \{\s*\.answer \{([^}]*)\}/.exec(css);
    expect(phone).not.toBeNull();
    expect(phone?.[1]).toContain('font-size: var(--font-body-size)');
  });

  it('lets the on-screen keyboard resize the page', async () => {
    const { viewport } = await import('@/app/layout');
    expect(viewport.interactiveWidget).toBe('resizes-content');
  });
});
