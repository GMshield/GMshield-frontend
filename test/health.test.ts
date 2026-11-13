import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/health/route';
import { BACKEND_TIMEOUT_MS } from '@/server/backend/client';

import { captureOutput } from './support/capture';
import { closedAddress, startFixed, startSilent, startStandIn, type Running } from './support/servers';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';

async function health(backendUrl: string, traceparent?: string): Promise<Response> {
  vi.stubEnv('GMSHIELD_MODE', '');
  vi.stubEnv('GMSHIELD_BACKEND_URL', backendUrl);
  const headers = traceparent === undefined ? undefined : { traceparent };
  return GET(new Request('http://frontend:3000/api/health', { headers }));
}

describe('GET /api/health', () => {
  let running: Running | undefined;
  afterEach(async () => {
    await running?.close();
    running = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('Healthy: 200 UP when the backend reports the minimum version or newer', async () => {
    const output = captureOutput();
    for (const version of ['1.0.0', '1.4.2', '2.0.0']) {
      running = await startStandIn(version);
      const response = await health(running.url, `00-${TRACE_ID}-00f067aa0ba902b7-01`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'UP' });
      expect(response.headers.get('cache-control')).toBe('no-store');
      // The backend received the same trace, with the frontend's own span.
      expect(String(running.requests[0]!.headers.traceparent)).toMatch(new RegExp(`^00-${TRACE_ID}-[0-9a-f]{16}-01$`));
      await running.close();
      running = undefined;
    }
    expect(output.lines()).toEqual([]);
  });

  it('Old backend: 503 DOWN and one log line naming both versions', async () => {
    const output = captureOutput();
    running = await startStandIn('0.9.0');
    const response = await health(running.url, `00-${TRACE_ID}-00f067aa0ba902b7-01`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'DOWN' });
    const lines = output.lines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'WARN',
      traceId: TRACE_ID,
      unit: 'server.health',
      event: 'health.backend_outdated',
      backendVersion: '0.9.0',
      minimumVersion: '1.0.0',
    });
  });

  it('does not echo the backend body: a malformed version or an error answer is logged without it', async () => {
    const output = captureOutput();
    running = await startFixed(200, JSON.stringify({ version: 'secret-content <script>' }));
    let response = await health(running.url);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"status":"DOWN"}');
    await running.close();
    running = await startFixed(500, JSON.stringify({ title: 'secret-content' }), 'application/problem+json');
    response = await health(running.url);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"status":"DOWN"}');
    expect(output.raw()).not.toContain('secret-content');
    expect(output.lines().map((line) => line.event)).toEqual(['health.backend_version_invalid', 'health.backend_failed']);
    expect(output.lines()[1]).toMatchObject({ backendStatus: 500 });
  });

  it('Backend absent: 503 when the connection is refused, logged by error type only', async () => {
    const output = captureOutput();
    const response = await health(await closedAddress());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'DOWN' });
    const [line] = output.lines();
    expect(line).toMatchObject({ event: 'health.backend_unreachable', errorType: 'ECONNREFUSED' });
    expect(Object.keys(line!).sort()).toEqual(['errorType', 'event', 'level', 'timestamp', 'traceId', 'unit']);
  });

  it('Backend absent: 503 within about 2 s when the backend never answers', async () => {
    const output = captureOutput();
    running = await startSilent();
    const started = performance.now();
    const response = await health(running.url);
    const elapsed = performance.now() - started;
    expect(response.status).toBe(503);
    expect(BACKEND_TIMEOUT_MS).toBe(2000);
    expect(elapsed).toBeGreaterThanOrEqual(1900);
    expect(elapsed).toBeLessThan(3000);
    expect(output.lines()[0]).toMatchObject({ event: 'health.backend_unreachable', errorType: 'timeout' });
  });
});
