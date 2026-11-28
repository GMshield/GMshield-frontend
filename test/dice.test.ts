import { afterEach, describe, expect, it, vi } from 'vitest';

import { DICE, cryptoUint32, drawDie, parseFormula, roll, rollSentence, singleDie, type RandomSource, type Sides } from '@/dice';

/** A source that gives `values` in turn, then fails: every draw a test makes is one it planned. */
function scripted(values: readonly number[]): RandomSource & { readonly calls: () => number } {
  let next = 0;
  const source = () => {
    const value = values[next];
    if (value === undefined) {
      throw new Error('The scripted source ran out.');
    }
    next += 1;
    return value;
  };
  return Object.assign(source, { calls: () => next });
}

const SENTENCE = '{formula}: {dice}, total {total}';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the dice (Story 6.3)', () => {
  it('are d4, d6, d8, d10, d12, d20 and d100, in that order', () => {
    expect(DICE).toEqual([4, 6, 8, 10, 12, 20, 100]);
  });

  it('every face of every die can occur: a source enumerating 0 to S-1 gives each face from 1 to S once', () => {
    for (const sides of DICE) {
      const source = scripted(Array.from({ length: sides }, (_, value) => value));
      const faces = Array.from({ length: sides }, () => drawDie(sides, source));
      expect(faces).toEqual(Array.from({ length: sides }, (_, index) => index + 1));
    }
  });

  it('every face of every die can occur from the top of the accepted range too, and never outside 1 to S', () => {
    for (const sides of DICE) {
      const limit = 2 ** 32 - (2 ** 32 % sides);
      const source = scripted(Array.from({ length: sides }, (_, index) => limit - sides + index));
      const faces = Array.from({ length: sides }, () => drawDie(sides, source));
      expect(faces).toEqual(Array.from({ length: sides }, (_, index) => index + 1));
    }
  });

  it('20,000 real draws per die from crypto.getRandomValues stay within 1 to S and cover every face', () => {
    const random = vi.spyOn(Math, 'random');
    for (const sides of DICE) {
      const seen = new Set<number>();
      for (let draw = 0; draw < 20_000; draw += 1) {
        const face = drawDie(sides);
        expect(Number.isInteger(face)).toBe(true);
        expect(face).toBeGreaterThanOrEqual(1);
        expect(face).toBeLessThanOrEqual(sides);
        seen.add(face);
      }
      expect(seen.size).toBe(sides);
    }
    expect(random).not.toHaveBeenCalled();
  });

  it('draws from crypto.getRandomValues, one Uint32 at a time', () => {
    const getRandomValues = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const value = cryptoUint32();
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(getRandomValues.mock.calls[0]?.[0]).toBeInstanceOf(Uint32Array);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(2 ** 32);
  });

  it('throws away a value that would bias the draw (rejection sampling) and draws again', () => {
    for (const sides of DICE.filter((d) => 2 ** 32 % d !== 0)) {
      const limit = 2 ** 32 - (2 ** 32 % sides);
      // Every value from the limit up is refused; the next accepted value decides.
      const source = scripted([limit, 2 ** 32 - 1, 0]);
      expect(drawDie(sides, source)).toBe(1);
      expect(source.calls()).toBe(3);
    }
    // A die that divides 2^32 has no biased value: the largest one is its top face.
    for (const sides of [4, 8] as const) {
      const source = scripted([2 ** 32 - 1]);
      expect(drawDie(sides, source)).toBe(sides);
    }
  });

  it('refuses a source that gives anything but a Uint32', () => {
    for (const bad of [-1, 2 ** 32, 0.5, Number.NaN]) {
      expect(() => drawDie(6, scripted([bad]))).toThrow(RangeError);
    }
  });
});

describe('a formula (Story 6.3)', () => {
  it.each([
    ['d20', '1d20'],
    ['2d6+3', '2d6+3'],
    ['1d8-2', '1d8-2'],
    [' 2D6 + 3 ', '2d6+3'],
    ['1d8+2d6-1', '1d8+2d6-1'],
    ['4d6-1', '4d6-1'],
    ['1d8+2d6+3', '1d8+2d6+3'],
    ['d100', '1d100'],
    ['100d6', '100d6'],
    ['1d6+1000', '1d6+1000'],
    ['1d6+0', '1d6+0'],
    ['3+1d6', '3+1d6'],
    ['2d6-1d4', '2d6-1d4'],
    ['60d6+40d4', '60d6+40d4'],
    ['\t1d12\n', '1d12'],
    ['\t2d6\n-\t1 ', '2d6-1'],
    ['1d6+2+3', '1d6+2+3'],
  ])('reads %j as %j', (text, normalised) => {
    expect(parseFormula(text)?.text).toBe(normalised);
  });

  it.each([
    ['1d7'],
    ['d3'],
    ['abc'],
    [''],
    ['   '],
    ['60d6+41d4'],
    ['101d6'],
    ['0d6'],
    ['+2d6'],
    ['-2d6'],
    ['2d6+'],
    ['3'],
    ['3+4'],
    ['2d'],
    ['d'],
    ['2d6++3'],
    ['2d6+3d'],
    ['2d6*3'],
    ['2d6+1001'],
    ['02d6'],
    ['2d06'],
    ['2d6+03'],
    ['1d20d6'],
    ['2x6'],
    ['1e2d6'],
    ['2d6 3'],
    ['１d6'],
    ['1d10 0'],
    ['1 2d6'],
    ['2d6+1 0'],
    ['1 d12'],
    ['1d 12'],
    ['\t1 d 12\n'],
    ['2 d6'],
    ['2d 6+3'],
  ])('refuses %j', (text) => {
    expect(parseFormula(text)).toBeNull();
  });

  it('keeps each term with its sign and kind', () => {
    expect(parseFormula('1d8+2d6-1')?.terms).toEqual([
      { kind: 'dice', sign: 1, count: 1, sides: 8 },
      { kind: 'dice', sign: 1, count: 2, sides: 6 },
      { kind: 'modifier', sign: -1, value: 1 },
    ]);
  });
});

describe('a roll (Story 6.3)', () => {
  it('a die button: "1d20", one result, the total equal to it', () => {
    const result = roll(singleDie(20), scripted([16]));
    expect(result).toEqual({ formula: '1d20', results: [17], total: 17 });
  });

  it('"2d6+3": two results from 1 to 6, the total their sum plus 3', () => {
    const formula = parseFormula('2d6+3');
    expect(formula).not.toBeNull();
    const result = roll(formula!, scripted([3, 4]));
    expect(result).toEqual({ formula: '2d6+3', results: [4, 5], total: 12 });
  });

  it('"1d8-2": the total is the result minus 2, below 1 when it rolls low', () => {
    expect(roll(parseFormula('1d8-2')!, scripted([0])).total).toBe(-1);
  });

  it('"1d8+2d6-1": one 1-8 and two 1-6 results, in the formula\'s order, the total their sum minus 1', () => {
    expect(roll(parseFormula('1d8+2d6-1')!, scripted([7, 5, 0]))).toEqual({ formula: '1d8+2d6-1', results: [8, 6, 1], total: 14 });
  });

  it('a subtracted dice group counts against the total', () => {
    expect(roll(parseFormula('2d6-1d4')!, scripted([5, 5, 3])).total).toBe(8);
  });

  it('rolls stay within their dice\'s ranges with the real source', () => {
    for (let index = 0; index < 200; index += 1) {
      const result = roll(parseFormula('1d8+2d6-1')!);
      expect(result.results).toHaveLength(3);
      expect(result.results[0]).toBeGreaterThanOrEqual(1);
      expect(result.results[0]).toBeLessThanOrEqual(8);
      for (const face of result.results.slice(1)) {
        expect(face).toBeGreaterThanOrEqual(1);
        expect(face).toBeLessThanOrEqual(6);
      }
      expect(result.total).toBe(result.results.reduce((sum, face) => sum + face, 0) - 1);
    }
  });

  it('each die button\'s formula reads back as itself', () => {
    for (const sides of DICE) {
      expect(parseFormula(singleDie(sides as Sides).text)).toEqual(singleDie(sides));
    }
  });
});

describe("a roll's sentence (Story 6.3)", () => {
  it('says the formula, the dice and the total in one sentence', () => {
    expect(rollSentence({ formula: '2d6+3', results: [4, 5], total: 12 }, SENTENCE)).toBe('2d6+3: 4, 5, total 12');
    expect(rollSentence({ formula: '1d8-2', results: [1], total: -1 }, SENTENCE)).toBe('1d8-2: 1, total -1');
  });

  it('leaves any other placeholder as it is', () => {
    expect(rollSentence({ formula: '1d4', results: [2], total: 2 }, '{formula} {other} {total}')).toBe('1d4 {other} 2');
  });
});
