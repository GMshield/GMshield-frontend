import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsRefused, TEST_MODE_BACKEND_URL, TEST_MODE_FRONTEND_CREDENTIAL, checkSettings } from '@/server/settings';
import { REFUSED_EXIT_STATUS, checkStartup } from '@/server/startup';

import { captureOutput } from './support/capture';

const SECRET_LOOKING = 'http://user:hunter2@backend.internal:8080';
const CREDENTIAL = 'c0ffee'.repeat(10) + 'beef';
const PRODUCTION = { GMSHIELD_BACKEND_URL: 'http://backend:8080', GMSHIELD_FRONTEND_CREDENTIAL: CREDENTIAL };

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

  it('reads the backend address and the service credential', () => {
    expect(checkSettings({ ...PRODUCTION, GMSHIELD_BACKEND_URL: 'http://backend:8080/' })).toEqual({
      testMode: false,
      backendUrl: 'http://backend:8080',
      frontendCredential: CREDENTIAL,
    });
  });

  it('refuses a start outside test mode without GMSHIELD_BACKEND_URL or GMSHIELD_FRONTEND_CREDENTIAL, naming them', () => {
    for (const environment of [{ GMSHIELD_FRONTEND_CREDENTIAL: CREDENTIAL }, { ...PRODUCTION, GMSHIELD_BACKEND_URL: '' }, { ...PRODUCTION, GMSHIELD_BACKEND_URL: '  ' }]) {
      const refused = refusal(environment);
      expect(refused.reason).toBe('setting.missing');
      expect(refused.settings).toEqual(['GMSHIELD_BACKEND_URL']);
    }
    for (const environment of [{ GMSHIELD_BACKEND_URL: 'http://backend:8080' }, { ...PRODUCTION, GMSHIELD_FRONTEND_CREDENTIAL: ' ' }]) {
      const refused = refusal(environment);
      expect(refused.reason).toBe('setting.missing');
      expect(refused.settings).toEqual(['GMSHIELD_FRONTEND_CREDENTIAL']);
    }
    expect(refusal({}).settings).toEqual(['GMSHIELD_BACKEND_URL', 'GMSHIELD_FRONTEND_CREDENTIAL']);
  });

  it('refuses a service credential that is short or cannot be a header, without printing it', () => {
    for (const value of ['short', 'a'.repeat(31), `has space ${'a'.repeat(32)}`, `line\nbreak${'a'.repeat(32)}`, 'a'.repeat(513), `ação${'a'.repeat(32)}`]) {
      const refused = refusal({ ...PRODUCTION, GMSHIELD_FRONTEND_CREDENTIAL: value });
      expect(refused.reason, value).toBe('setting.invalid');
      expect(refused.settings).toEqual(['GMSHIELD_FRONTEND_CREDENTIAL']);
      expect(refused.message).not.toContain(value);
    }
  });

  it('refuses the public test-mode credential outside test mode, naming only the setting', () => {
    const refused = refusal({ ...PRODUCTION, GMSHIELD_FRONTEND_CREDENTIAL: TEST_MODE_FRONTEND_CREDENTIAL });
    expect(refused.reason).toBe('setting.invalid');
    expect(refused.settings).toEqual(['GMSHIELD_FRONTEND_CREDENTIAL']);
    expect(refused.message).not.toContain(TEST_MODE_FRONTEND_CREDENTIAL);
  });

  it('in test mode, uses the fixed public credential and refuses a real one beside it', () => {
    expect(checkSettings({ GMSHIELD_MODE: 'test' }).frontendCredential).toBe(TEST_MODE_FRONTEND_CREDENTIAL);
    expect(TEST_MODE_FRONTEND_CREDENTIAL).toBe('gmshield-test-mode-frontend-credential-not-a-secret');
    const refused = refusal({ GMSHIELD_MODE: 'test', GMSHIELD_FRONTEND_CREDENTIAL: CREDENTIAL });
    expect(refused.reason).toBe('mode.test_with_production_secret');
    expect(refused.settings).toEqual(['GMSHIELD_MODE', 'GMSHIELD_FRONTEND_CREDENTIAL']);
    expect(refused.message).not.toContain(CREDENTIAL);
  });

  it('refuses an address that is not http or https, without printing it', () => {
    for (const value of ['backend:8080', 'ftp://backend', SECRET_LOOKING]) {
      const refused = refusal({ ...PRODUCTION, GMSHIELD_BACKEND_URL: value });
      expect(refused.reason).toBe('setting.invalid');
      expect(refused.message).not.toContain(value);
      expect(refused.message).toContain('GMSHIELD_BACKEND_URL');
    }
  });

  it('uses the stand-in backend in test mode unless an address is set', () => {
    expect(checkSettings({ GMSHIELD_MODE: 'test' })).toEqual({
      testMode: true,
      backendUrl: TEST_MODE_BACKEND_URL,
      frontendCredential: TEST_MODE_FRONTEND_CREDENTIAL,
    });
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
    checkStartup({ GMSHIELD_BACKEND_URL: '', GMSHIELD_FRONTEND_CREDENTIAL: CREDENTIAL });
    expect(exit).toHaveBeenCalledWith(REFUSED_EXIT_STATUS);
    expect(REFUSED_EXIT_STATUS).not.toBe(0);
    const [line] = output.lines();
    expect(line).toMatchObject({ level: 'ERROR', unit: 'server.startup', event: 'startup.refused', reason: 'setting.missing', settings: ['GMSHIELD_BACKEND_URL'] });
  });

  it('prints no value of a refused setting', () => {
    const output = captureOutput();
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    checkStartup({ GMSHIELD_BACKEND_URL: SECRET_LOOKING, GMSHIELD_FRONTEND_CREDENTIAL: CREDENTIAL });
    expect(output.raw()).toContain('GMSHIELD_BACKEND_URL');
    expect(output.raw()).not.toContain('hunter2');
    expect(output.raw()).not.toContain(CREDENTIAL);
  });

  it('lets a valid start through', () => {
    const output = captureOutput();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    checkStartup(PRODUCTION);
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
