import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AnswerMarkdown, type CitationMark } from '@/components/conversation/AnswerMarkdown';

afterEach(cleanup);

const linkText = (words: string, address: string) => `${words} (${address})`;

/** The answer's length in code points, the unit of a mark's offset. */
function lengthOf(text: string): number {
  return Array.from(text).length;
}

/** The answer rendered with its marks: the container, its superscripts' numbers and the text of its code blocks. */
function shown(text: string, marks: CitationMark[]) {
  const { container } = render(<AnswerMarkdown text={text} linkText={linkText} marks={marks} citationWord="fonte" />);
  const numbers = Array.from(container.querySelectorAll('sup')).map((sup) => sup.lastChild?.textContent);
  const code = Array.from(container.querySelectorAll('pre code')).map((block) => block.textContent);
  return { container, numbers, code };
}

/** No superscript inside code, no script, and no fence left as text outside a code block (in any element). */
function expectCodeClean(container: HTMLElement) {
  expect(container.querySelector('code sup')).toBeNull();
  expect(container.querySelector('script')).toBeNull();
  for (const element of [container, ...Array.from(container.querySelectorAll('*'))]) {
    if (element.closest('pre, code') !== null) {
      continue;
    }
    const own = Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE);
    expect(own.map((node) => node.textContent).join('')).not.toMatch(/```|~~~/);
  }
}

/** The text just before the only superscript, and just after it. */
function around(container: HTMLElement) {
  const sup = container.querySelector('sup')!;
  return [sup.previousSibling?.textContent, sup.nextSibling?.textContent];
}

/** `after` comes after `before` in the document. */
function expectAfter(before: Element, after: Element) {
  expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

const SCRIPT = '<script>alert(1)</script>';

describe('a citation never breaks or enters code', () => {
  it.each([
    ['a backtick fence', `O Corvo de Cinza:\n\n\`\`\`\n${SCRIPT}\n\`\`\``],
    ['a backtick fence and a final line break', `O Corvo de Cinza:\n\n\`\`\`\n${SCRIPT}\n\`\`\`\n`],
    ['a tilde fence', `O Corvo de Cinza:\n\n~~~\n${SCRIPT}\n~~~`],
    ['a longer fence with an info string', `O Corvo de Cinza:\n\n\`\`\`\`html\n${SCRIPT}\n\`\`\`\``],
    ['CRLF line breaks', `O Corvo de Cinza:\r\n\r\n\`\`\`\r\n${SCRIPT}\r\n\`\`\`\r\n`],
  ])('fence at the end (%s): the block closes with its code only, the superscript in a paragraph after it', (_name, text) => {
    const { container, numbers, code } = shown(text, [{ offset: lengthOf(text), number: 1 }]);
    expect(code).toEqual([`${SCRIPT}\n`]);
    expect(numbers).toEqual(['1']);
    expectCodeClean(container);
    const sup = container.querySelector('sup')!;
    expect(sup.parentElement!.tagName).toBe('P');
    expect(sup.parentElement!.textContent).toBe('fonte 1');
    expect(sup.parentElement!.previousElementSibling!.tagName).toBe('PRE');
  });

  it('fence in a list: one list, the block closed, the superscript right after it inside the same item', () => {
    const text = '- A\n  ```\n  code\n  ```\n- B';
    const end = lengthOf('- A\n  ```\n  code\n  ```');
    const { container, numbers, code } = shown(text, [{ offset: end, number: 1 }]);
    expect(container.querySelectorAll('ul')).toHaveLength(1);
    const items = Array.from(container.querySelectorAll('li'));
    expect(items).toHaveLength(2);
    expect(code).toEqual(['code\n']);
    expect(numbers).toEqual(['1']);
    expectCodeClean(container);
    const sup = container.querySelector('sup')!;
    expect(sup.closest('li')).toBe(items[0]);
    expectAfter(items[0]!.querySelector('pre')!, sup);
    expect(items[1]!.textContent).toBe('B');
  });

  it('fence in a quote: one quote, the block closed, the superscript right after it inside the quote', () => {
    const text = '> Veja:\n>\n> ```\n> code\n> ```\n\nFim.';
    const end = lengthOf('> Veja:\n>\n> ```\n> code\n> ```');
    const { container, numbers, code } = shown(text, [{ offset: end, number: 1 }]);
    expect(container.querySelectorAll('blockquote')).toHaveLength(1);
    expect(code).toEqual(['code\n']);
    expect(numbers).toEqual(['1']);
    expectCodeClean(container);
    const sup = container.querySelector('sup')!;
    const quote = container.querySelector('blockquote')!;
    expect(sup.closest('blockquote')).toBe(quote);
    expect(sup.parentElement!.previousElementSibling).toBe(quote.querySelector('pre'));
    expect(container.lastElementChild!.textContent).toBe('Fim.');
  });

  it('mark inside fenced code: after the block, several in source order', () => {
    const text = `O Corvo:\n\n\`\`\`\n${SCRIPT}\n\`\`\`\n\nE mais nada.`;
    const inside = Array.from(text).indexOf('<') + 3;
    const { container, numbers, code } = shown(text, [
      { offset: inside + 1, number: 3 },
      { offset: inside, number: 2 },
      { offset: lengthOf(text), number: 4 },
    ]);
    expect(code).toEqual([`${SCRIPT}\n`]);
    expect(numbers).toEqual(['2', '3', '4']);
    expectCodeClean(container);
    expect(container.querySelector('pre')!.nextElementSibling!.textContent).toBe('fonte 2fonte 3');
    expect(container.querySelector('p:last-of-type')!.textContent).toBe('E mais nada.fonte 4');
  });

  it('mark inside indented code: after the block', () => {
    const text = 'Trecho:\n\n    linha um\n    linha dois\n\nFim.';
    const { container, numbers, code } = shown(text, [{ offset: lengthOf('Trecho:\n\n    linha'), number: 1 }]);
    expect(code).toEqual(['linha um\nlinha dois\n']);
    expect(numbers).toEqual(['1']);
    expectCodeClean(container);
    expect(container.querySelector('pre')!.nextElementSibling!.textContent).toBe('fonte 1');
  });

  it('mark on or inside inline code: right after the code span', () => {
    const text = 'Use `rolar d20` agora.';
    const { container, numbers } = shown(text, [
      { offset: lengthOf('Use `rol'), number: 1 },
      { offset: lengthOf('Use `rolar d20`'), number: 2 },
    ]);
    expect(numbers).toEqual(['1', '2']);
    expectCodeClean(container);
    expect(container.querySelector('code')!.textContent).toBe('rolar d20');
    const parts = Array.from(container.querySelector('p')!.childNodes).map((node) => node.nodeName);
    expect(parts).toEqual(['#text', 'CODE', 'SUP', 'SUP', '#text']);
  });

  it('text after a block renders as Markdown, not as code', () => {
    const text = `\`\`\`\n${SCRIPT}\n\`\`\`\n\n**negrito** e [o SRD](https://srd.example/x).`;
    const { container, numbers, code } = shown(text, [{ offset: lengthOf(`\`\`\`\n${SCRIPT}\n\`\`\``), number: 1 }]);
    expect(code).toEqual([`${SCRIPT}\n`]);
    expect(numbers).toEqual(['1']);
    expectCodeClean(container);
    expect(container.querySelector('strong')!.textContent).toBe('negrito');
    expect(container.textContent).toContain('o SRD (https://srd.example/x)');
    expect(container.querySelector('a')).toBeNull();
  });

  it('unchanged places: emphasis end, before a line break, after an emoji, several marks at one place', () => {
    const text = '**Fogo.**\n\n😀 Gelo.\nVento.';
    const { container, numbers } = shown(text, [
      { offset: lengthOf('**Fogo.**'), number: 1 },
      { offset: lengthOf('**Fogo.**\n\n😀 Gelo.\n'), number: 3 },
      { offset: lengthOf('**Fogo.**\n\n😀 Gelo.\n'), number: 2 },
    ]);
    expect(numbers).toEqual(['1', '3', '2']);
    const strong = container.querySelector('strong')!;
    expect(strong.firstChild!.textContent).toBe('Fogo.');
    expect(strong.lastChild!.nodeName).toBe('SUP');
    const second = container.querySelectorAll('p')[1]!;
    expect(Array.from(second.childNodes).map((node) => (node.nodeName === 'SUP' ? 'SUP' : node.textContent))).toEqual([
      '😀 Gelo.',
      'SUP',
      'SUP',
      '\nVento.',
    ]);
    expect(container.textContent).not.toContain('*');
  });

  it('block never closed: the superscript after the block, never inside code', () => {
    const text = `Trecho:\n\n\`\`\`\n${SCRIPT}\nsem fim`;
    const { container, numbers, code } = shown(text, [{ offset: lengthOf(text), number: 1 }]);
    expect(code).toEqual([`${SCRIPT}\nsem fim\n`]);
    expect(numbers).toEqual(['1']);
    expectCodeClean(container);
    expectAfter(container.querySelector('pre')!, container.querySelector('sup')!);
  });

  it('a tilde fence inside a backtick block is code, and the block still closes', () => {
    const text = '```\n~~~\nx\n~~~\n```\n\nFim.';
    const { container, numbers, code } = shown(text, [{ offset: lengthOf('```\n~~~\nx\n~~~\n```'), number: 1 }]);
    expect(code).toEqual(['~~~\nx\n~~~\n']);
    expect(numbers).toEqual(['1']);
    expect(container.querySelector('code sup')).toBeNull();
    expect(container.querySelector('pre')!.nextElementSibling!.textContent).toBe('fonte 1');
    expect(container.querySelector('p:last-of-type')!.textContent).toBe('Fim.');
  });

  it('a shorter closing fence does not close a longer one', () => {
    const text = '````\ncode\n```\nmais\n````\n\nFim.';
    const { container, numbers, code } = shown(text, [{ offset: lengthOf('````\ncode\n```'), number: 1 }]);
    expect(code).toEqual(['code\n```\nmais\n']);
    expect(numbers).toEqual(['1']);
    expect(container.querySelector('code sup')).toBeNull();
    expect(container.querySelector('pre')!.nextElementSibling!.textContent).toBe('fonte 1');
  });

  it('a mark at offset 0 before a block goes after the block', () => {
    const text = '```\ncode\n```\n\nFim.';
    const { container, numbers, code } = shown(text, [{ offset: 0, number: 1 }]);
    expect(code).toEqual(['code\n']);
    expect(numbers).toEqual(['1']);
    expectCodeClean(container);
    expect(container.querySelector('pre')!.nextElementSibling!.textContent).toBe('fonte 1');
    expect(container.querySelector('p:last-of-type')!.textContent).toBe('Fim.');
  });
});

describe('a mark inside text whose source has syntax of its own lands after the text it follows', () => {
  const PRIVATE = String.fromCodePoint(0xf0007);

  it.each([
    ['an escaped character', 'a \\*b c', 'a \\*b', ['a *b', ' c']],
    ['the second line of a quote', '> um\n> dois três', '> um\n> doi', ['um\ndoi', 's três']],
    ['the second line of a list item', '- um\n  dois três', '- um\n  doi', ['um\ndoi', 's três']],
    ['a reference decoding to "&"', '&amp;and fim', '&amp;', ['&', 'and fim']],
    ['a numeric reference', 'x &#42;y fim', 'x &#42;y', ['x *y', ' fim']],
    ['a U+0000, shown as U+FFFD', 'a\u0000b c', 'a\u0000b', ['a\uFFFDb', ' c']],
    ['a private-use code point', `Um${PRIVATE} dois`, `Um${PRIVATE} do`, [`Um${PRIVATE} do`, 'is']],
  ])('%s', (_name, text, before, expected) => {
    const { container, numbers } = shown(text, [{ offset: lengthOf(before), number: 1 }]);
    expect(numbers).toEqual(['1']);
    expect(around(container)).toEqual(expected);
  });
});

describe('a mark on syntax goes where the text says', () => {
  it.each([
    ['inside a link\'s words', 'Veja [o S'],
    ['at a link\'s end', 'Veja [o SRD](https://srd.example/x)'],
  ])('a mark %s goes right after the link, its words and address whole', (_name, before) => {
    const text = 'Veja [o SRD](https://srd.example/x) agora.';
    const { container, numbers } = shown(text, [{ offset: lengthOf(before), number: 1 }]);
    expect(numbers).toEqual(['1']);
    const sup = container.querySelector('sup')!;
    const span = container.querySelector('p > span')!;
    expect(span.textContent).toBe('o SRD (https://srd.example/x)');
    expect(span.nextSibling).toBe(sup);
    expect(sup.nextSibling?.textContent).toBe(' agora.');
  });

  it('a mark on a heading\'s # marker goes at the heading\'s start', () => {
    const { container, numbers } = shown('## Título\n\nMais.', [{ offset: 1, number: 1 }]);
    expect(numbers).toEqual(['1']);
    const heading = container.querySelector('h2')!;
    expect(heading.firstChild?.nodeName).toBe('SUP');
    expect(heading.textContent).toBe('fonte 1Título');
  });

  it('a mark in an empty list item gets the superscript in that item', () => {
    const { container, numbers } = shown('- um\n-\n- três', [{ offset: lengthOf('- um\n-'), number: 1 }]);
    expect(numbers).toEqual(['1']);
    const items = Array.from(container.querySelectorAll('li'));
    expect(items.map((item) => item.textContent)).toEqual(['um', 'fonte 1', 'três']);
    expect(container.querySelector('sup')!.closest('li')).toBe(items[1]);
  });

  it('a mark in an empty quote gets a paragraph with the superscript in that quote', () => {
    const { container, numbers } = shown('>\n\nFim.', [{ offset: 1, number: 1 }]);
    expect(numbers).toEqual(['1']);
    const paragraph = container.querySelector('blockquote > p')!;
    expect(paragraph.textContent).toBe('fonte 1');
    expect(container.lastElementChild!.textContent).toBe('Fim.');
  });

  it('a mark on a thematic break gets a paragraph after it', () => {
    const text = 'Antes.\n\n---\n\nDepois.';
    const { container, numbers } = shown(text, [{ offset: lengthOf('Antes.\n\n---'), number: 1 }]);
    expect(numbers).toEqual(['1']);
    const next = container.querySelector('hr')!.nextElementSibling!;
    expect(next.tagName).toBe('P');
    expect(next.textContent).toBe('fonte 1');
    expect(container.lastElementChild!.textContent).toBe('Depois.');
  });
});
