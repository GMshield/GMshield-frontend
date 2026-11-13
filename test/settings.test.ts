import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsRefused, TEST_MODE_BACKEND_URL, checkSettings } from '@/server/settings';
import { REFUSED_EXIT_STATUS, checkStartup } from '@/server/startup';

import { captureOutput } from './support/capture';

const SECRET_LOOKING = 'http://user:hunter2@backend.internal:8080';

function refusal(environment: Record<string, string | undefined>): SettingsRefused {
  try {
    checkSettings(environment);
  } catch (error) {
    if (error instanceof SettingsRefused) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('settings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads the backend address', () => {
    expect(checkSettings({ GMSHIELD_BACKEND_URL: 'http://backend:8080/' })).toEqual({
      testMode: false,
      backendUrl: 'http://backend:8080',
    });
  });

  it('refuses a start outside test mode without GMSHIELD_BACKEND_URL', () => {
    for (const environment of [{}, { GMSHIELD_BACKEND_URL: '' }, { GMSHIELD_BACKEND_URL: '  ' }]) {
      const refused = refusal(environment);
      expect(refused.reason).toBe('setting.missing');
      expect(refused.settings).toEqual(['GMSHIELD_BACKEND_URL']);
    }
  });

  it('refuses an address that is not http or https, without printing it', () => {
    for (const value of ['backend:8080', 'ftp://backend', SECRET_LOOKING]) {
      const refused = refusal({ GMSHIELD_BACKEND_URL: value });
      expect(refused.reason).toBe('setting.invalid');
      expect(refused.message).not.toContain(value);
      expect(refused.message).toContain('GMSHIELD_BACKEND_URL');
    }
  });

  it('uses the stand-in backend in test mode unless an address is set', () => {
    expect(checkSettings({ GMSHIELD_MODE: 'test' })).toEqual({ testMode: true, backendUrl: TEST_MODE_BACKEND_URL });
    expect(checkSettings({ GMSHIELD_MODE: 'test', GMSHIELD_BACKEND_URL: 'http://other:9000' }).backendUrl).toBe('http://other:9000');
  });

  it('refuses an unknown mode', () => {
    const refused = refusal({ GMSHIELD_MODE: 'production', GMSHIELD_BACKEND_URL: 'http://backend:8080' });
    expect(refused.reason).toBe('mode.unknown');
    expect(refused.settings).toEqual(['GMSHIELD_MODE']);
  });
});

describe('start-up check (Missing setting)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits non-zero, naming the setting and printing no value', () => {
    const output = captureOutput();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    checkStartup({ GMSHIELD_BACKEND_URL: '' });
    expect(exit).toHaveBeenCalledWith(REFUSED_EXIT_STATUS);
    expect(REFUSED_EXIT_STATUS).not.toBe(0);
    const [line] = output.lines();
    expect(line).toMatchObject({ level: 'ERROR', unit: 'server.startup', event: 'startup.refused', reason: 'setting.missing', settings: ['GMSHIELD_BACKEND_URL'] });
  });

  it('prints no value of a refused setting', () => {
    const output = captureOutput();
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    checkStartup({ GMSHIELD_BACKEND_URL: SECRET_LOOKING });
    expect(output.raw()).toContain('GMSHIELD_BACKEND_URL');
    expect(output.raw()).not.toContain('hunter2');
  });

  it('lets a valid start through', () => {
    const output = captureOutput();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    checkStartup({ GMSHIELD_BACKEND_URL: 'http://backend:8080' });
    expect(exit).not.toHaveBeenCalled();
    expect(output.lines()[0]).toMatchObject({ event: 'startup.checked', testMode: false });
  });

  it('runs from the instrumentation hook in the Node.js runtime', async () => {
    captureOutput();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('GMSHIELD_MODE', '');
    vi.stubEnv('GMSHIELD_BACKEND_URL', '');
    const { register } = await import('@/instrumentation');
    await register();
    vi.unstubAllEnvs();
    expect(exit).toHaveBeenCalledWith(REFUSED_EXIT_STATUS);
  });
});
