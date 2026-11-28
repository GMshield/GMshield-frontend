/**
 * Dice (Story 6.3): the one place for the rules of a roll. It reads a formula, draws each die from the browser's
 * cryptographically secure source and adds up the total. It is pure (no request, no storage), so a roll works with no
 * connection once the page has loaded. Story 6.4's backend check copies these rules.
 *
 * The grammar: a sum of terms joined by `+` or `-`, such as "1d8+2d6+3", "4d6-1" or "d20".
 * - A term is a dice group `[N]dS` (an omitted N means 1) or a whole-number modifier. Terms come in any order and any
 *   number: a modifier may come first ("3+1d6"), a dice group may be subtracted ("2d6-1d4"), and several modifiers are
 *   allowed and kept as written ("1d6+2+3").
 * - The first term has no sign, and at least one dice group is needed.
 * - S is one of 4, 6, 8, 10, 12, 20 or 100; N runs from 1 to 100 and a modifier from 0 to 1000, with at most 100 dice in
 *   all. The number of terms is not capped, only the dice and each modifier.
 * - Numbers are written without leading zeros ("02d6", "2d06" and "2d6+03" are refused; "0" alone is a modifier).
 * - White space (any, tabs and line breaks too) may stand only at either end and around a `+` or `-` (" 2D6 + 3 "). It is
 *   refused inside a term: between two digits ("1d10 0", "2d6+1 0", "1 2d6"), between a digit and `d` ("1 d12") and
 *   between `d` and a digit ("1d 12").
 * - `D` reads as `d`. The normalised form (no white space, the count written: "1d20") is what is shown.
 */

/** The dice, in the order the roller shows them. */
export const DICE = [4, 6, 8, 10, 12, 20, 100] as const;
export type Sides = (typeof DICE)[number];

/** The most dice in one group, and in one formula. */
export const MAX_DICE = 100;
/** The largest modifier. */
export const MAX_MODIFIER = 1000;

export type DiceTerm = { readonly kind: 'dice'; readonly sign: 1 | -1; readonly count: number; readonly sides: Sides };
export type ModifierTerm = { readonly kind: 'modifier'; readonly sign: 1 | -1; readonly value: number };
export type Term = DiceTerm | ModifierTerm;

/** A formula that reads: its normalised text and its terms, in order. */
export type Formula = { readonly text: string; readonly terms: readonly Term[] };

/** A roll: the formula's normalised text, each die's result in the formula's order, and the total. */
export type Roll = { readonly formula: string; readonly results: readonly number[]; readonly total: number };

/** A source of uniform whole numbers from 0 to 2^32 - 1. */
export type RandomSource = () => number;

const UINT32_RANGE = 2 ** 32;

/** One `Uint32` from `crypto.getRandomValues`, the default source. Never `Math.random`. */
export function cryptoUint32(): number {
  const buffer = globalThis.crypto.getRandomValues(new Uint32Array(1));
  // Never undefined; NaN would make drawDie throw rather than give a biased face.
  return buffer.at(0) ?? Number.NaN;
}

/**
 * One die from 1 to `sides`, without modulo bias: a value at or above the largest multiple of `sides` under 2^32 is
 * thrown away and another is drawn (rejection sampling).
 */
export function drawDie(sides: Sides, random: RandomSource = cryptoUint32): number {
  const limit = UINT32_RANGE - (UINT32_RANGE % sides);
  for (;;) {
    const value = random();
    if (!Number.isInteger(value) || value < 0 || value >= UINT32_RANGE) {
      throw new RangeError('The random source must give whole numbers from 0 to 2^32 - 1.');
    }
    if (value < limit) {
      return (value % sides) + 1;
    }
  }
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= '0' && character <= '9';
}

/** A number written with no leading zero and within `min` and `max`, else null. */
function readNumber(digits: string, min: number, max: number): number | null {
  if (digits === '' || digits.length > String(max).length || (digits.length > 1 && digits.startsWith('0'))) {
    return null;
  }
  const value = Number(digits);
  return value >= min && value <= max ? value : null;
}

function sidesOf(digits: string): Sides | null {
  return DICE.find((sides) => String(sides) === digits) ?? null;
}

/** A term's normalised text: its sign (none for the first), then "NdS" or the modifier. */
function termText(term: Term, first: boolean): string {
  const body = term.kind === 'dice' ? `${term.count}d${term.sides}` : String(term.value);
  if (first) {
    return body;
  }
  return (term.sign === 1 ? '+' : '-') + body;
}

function isSpace(character: string | undefined): boolean {
  return character !== undefined && /^\s$/.test(character);
}

function skipSpace(source: string, from: number): number {
  let at = from;
  while (isSpace(source[at])) {
    at += 1;
  }
  return at;
}

function skipDigits(source: string, from: number): number {
  let at = from;
  while (isDigit(source[at])) {
    at += 1;
  }
  return at;
}

/** The term written at `from` (no white space inside it) and where it ends, or null when none reads there. */
function readTerm(source: string, from: number, sign: 1 | -1): { readonly term: Term; readonly end: number } | null {
  const digitsEnd = skipDigits(source, from);
  const digits = source.slice(from, digitsEnd);
  if (source[digitsEnd] !== 'd') {
    const value = readNumber(digits, 0, MAX_MODIFIER);
    return value === null ? null : { term: { kind: 'modifier', sign, value }, end: digitsEnd };
  }
  const sidesEnd = skipDigits(source, digitsEnd + 1);
  const count = digits === '' ? 1 : readNumber(digits, 1, MAX_DICE);
  const sides = sidesOf(source.slice(digitsEnd + 1, sidesEnd));
  return count === null || sides === null ? null : { term: { kind: 'dice', sign, count, sides }, end: sidesEnd };
}

/** The formula `text` reads as, or null when it does not follow the grammar. */
export function parseFormula(text: string): Formula | null {
  const source = text.replaceAll('D', 'd');
  const terms: Term[] = [];
  let at = skipSpace(source, 0);
  do {
    let sign: 1 | -1 = 1;
    if (terms.length > 0) {
      if (source[at] !== '+' && source[at] !== '-') {
        return null;
      }
      sign = source[at] === '-' ? -1 : 1;
      at = skipSpace(source, at + 1);
    }
    const read = readTerm(source, at, sign);
    if (read === null) {
      return null;
    }
    terms.push(read.term);
    at = skipSpace(source, read.end);
  } while (at < source.length);
  const dice = terms.reduce((sum, term) => sum + (term.kind === 'dice' ? term.count : 0), 0);
  if (dice === 0 || dice > MAX_DICE) {
    return null;
  }
  return { text: terms.map((term, index) => termText(term, index === 0)).join(''), terms };
}

/** The formula of one die of a kind, such as "1d20" (a die button). */
export function singleDie(sides: Sides): Formula {
  return { text: `1d${sides}`, terms: [{ kind: 'dice', sign: 1, count: 1, sides }] };
}

/** Draws every die of `formula`, in order, and adds them and the modifiers up, each with its sign. */
export function roll(formula: Formula, random: RandomSource = cryptoUint32): Roll {
  const results: number[] = [];
  let total = 0;
  for (const term of formula.terms) {
    if (term.kind === 'modifier') {
      total += term.sign * term.value;
      continue;
    }
    for (let index = 0; index < term.count; index += 1) {
      const result = drawDie(term.sides, random);
      results.push(result);
      total += term.sign * result;
    }
  }
  return { formula: formula.text, results, total };
}

/**
 * The roll as one sentence for a screen reader, from the translated `template` with `{formula}`, `{dice}` and `{total}`:
 * "2d6+3: 4, 5, total 12".
 */
export function rollSentence(result: Roll, template: string): string {
  const values: Readonly<Record<string, string>> = {
    formula: result.formula,
    dice: result.results.join(', '),
    total: String(result.total),
  };
  return template.replace(/\{(formula|dice|total)\}/g, (placeholder, name: string) => values[name] ?? placeholder);
}
