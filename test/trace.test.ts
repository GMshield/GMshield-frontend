import { describe, expect, it } from 'vitest';

import { outgoingTraceparent, parseTraceparent, traceFrom } from '@/server/trace';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const VALID = `00-${TRACE_ID}-00f067aa0ba902b7-01`;

describe('traceparent', () => {
  it('keeps the trace id of a valid header', () => {
    expect(parseTraceparent(VALID)).toEqual({ traceId: TRACE_ID, flags: '01' });
    expect(traceFrom(VALID).traceId).toBe(TRACE_ID);
  });

  it('starts a new trace for a missing or malformed header', () => {
    for (const invalid of [
      null,
      undefined,
      '',
      'garbage',
      `ff-${TRACE_ID}-00f067aa0ba902b7-01`,
      `00-${'0'.repeat(32)}-00f067aa0ba902b7-01`,
      `00-${TRACE_ID}-${'0'.repeat(16)}-01`,
      `00-${TRACE_ID}-00f067aa0ba902b7-01-extra`,
      `00-${TRACE_ID.toUpperCase()}-00f067aa0ba902b7-01`,
    ]) {
      expect(parseTraceparent(invalid), String(invalid)).toBeNull();
      const trace = traceFrom(invalid);
      expect(trace.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(trace.traceId).not.toBe('0'.repeat(32));
    }
    expect(traceFrom(null).traceId).not.toBe(traceFrom(null).traceId);
  });

  it('accepts a future version with extra fields', () => {
    expect(parseTraceparent(`01-${TRACE_ID}-00f067aa0ba902b7-01-more`)?.traceId).toBe(TRACE_ID);
  });

  it('sends the same trace id with a new span id', () => {
    const outgoing = outgoingTraceparent({ traceId: TRACE_ID, flags: '01' });
    expect(outgoing).toMatch(new RegExp(`^00-${TRACE_ID}-[0-9a-f]{16}-01$`));
    expect(outgoing).not.toBe(VALID);
    expect(parseTraceparent(outgoing)?.traceId).toBe(TRACE_ID);
  });
});
