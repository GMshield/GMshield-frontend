import type { ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';

/** Every node's text, for a link's own words. */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join('');
  }
  if (node !== null && typeof node === 'object' && 'props' in node) {
    return textOf((node.props as { children?: ReactNode }).children);
  }
  return '';
}

export type AnswerMarkdownProps = {
  readonly text: string;
  /** A link's words with its address, as the interface writes them ("{text} ({address})"). */
  readonly linkText: (text: string, address: string) => string;
};

/**
 * An answer's text as sanitized Markdown (Story 2.4): raw HTML in the text is skipped (`skipHtml`, never rendered),
 * images are dropped, and a link is shown as its words with its address, never as an anchor. Nothing is set as HTML.
 */
export function AnswerMarkdown({ text, linkText }: AnswerMarkdownProps) {
  const components: Components = {
    img: () => null,
    a: ({ href, children }) => {
      const words = textOf(children);
      const address = typeof href === 'string' ? href : '';
      return <span>{address === '' || address === words ? words : linkText(words, address)}</span>;
    },
  };
  return (
    <Markdown skipHtml disallowedElements={['img']} components={components}>
      {text}
    </Markdown>
  );
}
