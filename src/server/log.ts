import 'server-only';

/**
 * One JSON object per line on standard output: `timestamp`, `level`, `traceId`, `unit` and
 * `event`, then the event's own fields. Fields are ids, numbers, versions, status codes and error
 * types: never content, never a secret, never a setting's value.
 */
export const NO_TRACE = '0'.repeat(32);

export type Level = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
export type Field = string | number | boolean | readonly string[];

export type LogLine = {
  timestamp: string;
  level: Level;
  traceId: string;
  unit: string;
  event: string;
  [field: string]: Field;
};

export function logLine(level: Level, unit: string, event: string, traceId: string, fields: Record<string, Field> = {}): LogLine {
  const line: LogLine = { timestamp: new Date().toISOString(), level, traceId, unit, event };
  for (const [name, value] of Object.entries(fields)) {
    // An event field never replaces a fixed one.
    if (!(name in line)) {
      line[name] = value;
    }
  }
  return line;
}

export function logEvent(level: Level, unit: string, event: string, traceId: string, fields: Record<string, Field> = {}): void {
  const line = JSON.stringify(logLine(level, unit, event, traceId, fields)) + '\n';
  if (level === 'ERROR') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}
