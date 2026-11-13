import { backendIsHealthy } from '@/server/health';

export const dynamic = 'force-dynamic';

/** 200 `{"status":"UP"}` when the backend answers with a recent enough contract, else 503. */
export async function GET(request: Request): Promise<Response> {
  const up = await backendIsHealthy(request.headers.get('traceparent'));
  return Response.json({ status: up ? 'UP' : 'DOWN' }, { status: up ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
