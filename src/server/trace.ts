import 'server-only';

/**
 * W3C trace context. A valid incoming `traceparent` keeps its trace id; otherwise a new trace
 * starts. Every call to the backend carries a `traceparent` with the trace id and a new span id,
 * so that the three applications log the same trace id.
 */
const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/;
const NO_TRACE_ID = '0'.repeat(32);
const NO_SPAN_ID = '0'.repeat(16);

export type Trace = {
  readonly traceId: string;
  readonly flags: string;
};

function randomHex(bytes: number, invalid: string): string {
  let value: string;
  do {
    value = Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('hex');
  } while (value === invalid);
  return value;
}

/** The trace of a valid `traceparent` header value; `null` when it is missing or malformed. */
export function parseTraceparent(header: string | null | undefined): Trace | null {
  if (header === null || header === undefined) {
    return null;
  }
  const match = TRACEPARENT.exec(header.trim());
  if (match === null) {
    return null;
  }
  const [, version, traceId, spanId, flags, extra] = match;
  if (version === 'ff' || (version === '00' && extra !== undefined) || traceId === NO_TRACE_ID || spanId === NO_SPAN_ID) {
    return null;
  }
  return { traceId: traceId!, flags: flags! };
}

/** The trace of the incoming header, or a new one. */
export function traceFrom(header: string | null | undefined): Trace {
  return parseTraceparent(header) ?? { traceId: randomHex(16, NO_TRACE_ID), flags: '01' };
}

/** A `traceparent` for one outgoing call of this trace: the same trace id, a new span id. */
export function outgoingTraceparent(trace: Trace): string {
  return `00-${trace.traceId}-${randomHex(8, NO_SPAN_ID)}-${trace.flags}`;
}
