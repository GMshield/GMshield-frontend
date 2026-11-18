import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const { LANGUAGES, errorText, failureText, interpolate, messagesFor, problemFields, translator } = await import('@/messages');
const { notFoundFor } = await import('@/app/not-found');
const en = (await import('@/messages/en.json')).default;
const ptBR = (await import('@/messages/pt-BR.json')).default;

// The categories and codes the backend sends today (GMshield-backend ApiProblem.java), integrity.failed
// (Story 1.7), sign-in and sessions (Story 1.9, AccountProblems.java), and the renewal and the service
// credential (Story 1.10, AccountProblems.java and ServiceCredentialFilter.java), the upload (Story 1.13,
// UploadProblems.java; Story 1.21 adds the image set's two), the page routes (Story 1.19, PageProblems.java), and the
// review actions (Story 1.20, MaterialProblems.java).
const BACKEND_CODES = {
  request: ['invalid', 'not_found', 'method_not_allowed', 'not_acceptable', 'too_large', 'unsupported_media_type', 'rejected', 'cross_origin',
    'sign_in_expired', 'sign_in_refused', 'username_taken', 'username_invalid', 'terms_required'],
  server: ['unexpected', 'unavailable'],
  integrity: ['failed'],
  session: ['required', 'renewal_required', 'already_renewed'],
  service: ['unauthenticated'],
  upload: ['tus_version', 'too_large', 'format_refused', 'busy', 'part_checksum_mismatch', 'offset_conflict', 'incomplete',
    'file_checksum_mismatch', 'expired', 'metadata_invalid', 'set_too_large', 'image_not_failed'],
  ingestion: ['password_required', 'file_unreadable', 'too_many_steps'],
  page: ['ground_unknown'],
  material: ['action_unavailable'],
} as const;

function leaves(value: unknown): string[] {
  return typeof value === 'object' && value !== null ? Object.values(value).flatMap(leaves) : [value as string];
}

describe('error texts', () => {
  it('known code: the text for that code', () => {
    expect(errorText({ category: 'integrity', code: 'integrity.failed' }, 'en')).toBe(en.errors.codes.integrity.failed);
    expect(errorText({ category: 'integrity', code: 'integrity.failed' }, 'pt-BR')).toBe(ptBR.errors.codes.integrity.failed);
    expect(errorText({ status: 404, category: 'request', code: 'request.not_found', params: {}, traceId: 'x' }, 'pt-BR')).toBe('Não encontrado.');
  });

  it('has a text for every code the backend sends, in both languages', () => {
    for (const language of LANGUAGES) {
      const codes = messagesFor(language).errors.codes as Record<string, Record<string, string>>;
      for (const [category, reasons] of Object.entries(BACKEND_CODES)) {
        for (const reason of reasons) {
          expect(codes[category]?.[reason], `${language} ${category}.${reason}`).toBeTruthy();
          const params = { min: 3, max: 24 };
          const expected = (codes[category]?.[reason] ?? '').replace('{min}', '3').replace('{max}', '24');
          expect(errorText({ category, code: `${category}.${reason}`, params }, language)).toBe(expected);
        }
      }
    }
  });

  it("unknown code: the category's text", () => {
    expect(errorText({ category: 'request', code: 'request.new_thing' }, 'en')).toBe(en.errors.categories.request);
    expect(errorText({ category: 'request', code: 'request.new_thing' }, 'pt-BR')).toBe(ptBR.errors.categories.request);
    // A code from another category, or no code, falls back to the problem's own category.
    expect(errorText({ category: 'request', code: 'server.unexpected' }, 'en')).toBe(en.errors.categories.request);
    expect(errorText({ category: 'integrity' }, 'en')).toBe(en.errors.categories.integrity);
    expect(errorText({ category: 'request', code: 'request.toString' }, 'en')).toBe(en.errors.categories.request);
    expect(errorText({ category: 'request', code: 'request.__proto__' }, 'en')).toBe(en.errors.categories.request);
  });

  it('unknown category or a malformed body: the generic server text, never the code', () => {
    const malformed: unknown[] = [
      { category: 'x', code: 'x.y' },
      null,
      undefined,
      'request.not_found',
      42,
      ['request', 'request.not_found'],
      {},
      { category: 7, code: 'request.invalid' },
      { category: '__proto__', code: '__proto__.x' },
      { category: 'constructor', code: 'constructor.name' },
      { category: 'toString' },
    ];
    for (const body of malformed) {
      const text = errorText(body, 'en');
      expect(text, JSON.stringify(body)).toBe(en.errors.categories.server);
      expect(text).not.toMatch(/x\.y|request\.|constructor|__proto__/);
    }
    expect(errorText({ category: 'x', code: 'x.y' }, 'pt-BR')).toBe(ptBR.errors.categories.server);
  });

  it('keeps only string and number params', () => {
    expect(problemFields({ status: 403, category: 'request', code: 'request.x', params: { limit: 5, name: 'a', bad: { x: 1 }, nan: Number.NaN } })).toEqual({
      status: 403,
      category: 'request',
      code: 'request.x',
      params: { limit: 5, name: 'a' },
    });
    expect(problemFields({ status: '404', params: 'x' })).toEqual({ status: null, category: null, code: null, params: {} });
  });

  it('every text is plain: no empty text and no exclamation mark', () => {
    for (const text of [...leaves(en), ...leaves(ptBR)]) {
      expect(typeof text).toBe('string');
      expect(text.trim()).not.toBe('');
      expect(text).not.toContain('!');
    }
  });
});

describe('sign-in texts (Story 1.9)', () => {
  it('say what the I/O matrix says, in both languages', () => {
    expect(errorText({ category: 'request', code: 'request.username_taken' }, 'pt-BR')).toBe('Este nome de usuário já está em uso.');
    expect(errorText({ category: 'request', code: 'request.sign_in_expired' }, 'pt-BR')).toBe('A tentativa de entrar expirou. Tente de novo.');
    expect(errorText({ category: 'request', code: 'request.username_invalid', params: { min: 3, max: 24 } }, 'en')).toBe(
      'Use 3 to 24 characters: letters a to z in upper or lower case, digits, "_", "." and "-".',
    );
    // Without its limits the invalid-username text falls back to the category's text, never a placeholder.
    expect(errorText({ category: 'request', code: 'request.username_invalid' }, 'en')).toBe(en.errors.categories.request);
    expect(errorText({ category: 'session', code: 'session.required' }, 'pt-BR')).toBe('Sua sessão terminou.');
    expect(errorText({ category: 'session', code: 'session.other' }, 'en')).toBe(en.errors.categories.session);
  });
});

describe('upload texts (Story 1.13)', () => {
  it('name the accepted formats and the limits, in both languages', () => {
    const refused = { status: 415, category: 'upload', code: 'upload.format_refused', params: { accepted: ['pdf', 'txt'] } };
    expect(errorText(refused, 'pt-BR')).toBe('Este formato não é aceito. Use PDF, TXT, Markdown, JPG, PNG, WebP, TIFF, BMP ou HEIC.');
    expect(errorText(refused, 'en')).toContain('PDF, TXT, Markdown, JPG, PNG, WebP, TIFF, BMP or HEIC');
    expect(errorText({ category: 'upload', code: 'upload.too_large', params: { limit: 2147483648 } }, 'en')).toContain('2 GB');
    expect(errorText({ category: 'upload', code: 'upload.expired' }, 'pt-BR')).toContain('6 horas');
    expect(errorText({ category: 'upload', code: 'upload.something_new' }, 'en')).toBe(en.errors.categories.upload);
  });
});

describe('ingestion texts (Story 1.15)', () => {
  it("a failed material's code has its text, else the category's, in both languages, never the code", () => {
    expect(failureText('ingestion.password_required', 'pt-BR')).toBe('Este PDF é protegido por senha. Remova a senha e envie o arquivo de novo.');
    expect(failureText('ingestion.password_required', 'en')).toBe(en.errors.codes.ingestion.password_required);
    expect(failureText('ingestion.file_unreadable', 'pt-BR')).toBe(ptBR.errors.codes.ingestion.file_unreadable);
    expect(failureText('ingestion.too_many_steps', 'en')).toBe(en.errors.codes.ingestion.too_many_steps);
    for (const code of ['ingestion.step_failed', 'ingestion.pipeline_changed', 'ingestion.stage_unknown']) {
      expect(failureText(code, 'pt-BR')).toBe('Este arquivo não pôde ser processado.');
      expect(failureText(code, 'en')).toBe('This file could not be processed.');
    }
    for (const code of [undefined, '', 'job.attempts_exhausted', 'nonsense']) {
      expect(failureText(code, 'en')).toBe(en.errors.categories.server);
    }
    expect(ptBR.material.pages).toBe('{done} de {total} páginas');
    expect(en.material.pages).toBe('{done} of {total} pages');
  });
});

describe('t(path, params)', () => {
  it('returns the text at a path in the chosen language', () => {
    expect(translator('pt-BR')('preferences.apply')).toBe('Aplicar');
    expect(translator('en')('preferences.apply')).toBe('Apply');
    expect(translator('pt-BR')('dialog.cancel')).toBe('Cancelar');
    expect(translator('en')('dialog.cancel')).toBe('Cancel');
    expect(translator('en')('preferences.languages.pt-BR')).toBe('Português (Brasil)');
  });

  it('fills {name} placeholders and leaves unknown ones', () => {
    expect(interpolate('{count} de {total} páginas', { count: 3, total: 10 })).toBe('3 de 10 páginas');
    expect(interpolate('{count} pages, {missing}', { count: 1 })).toBe('1 pages, {missing}');
    expect(interpolate('{constructor}', {})).toBe('{constructor}');
  });

  it('throws for a path that is not a string', () => {
    const t = translator('en') as (path: string) => string;
    expect(() => t('preferences')).toThrow('No message at preferences');
    expect(() => t('nope.nothing')).toThrow();
    expect(() => t('preferences.apply.more')).toThrow();
  });
});

describe('notFoundFor(problem)', () => {
  function digestOf(problem: unknown): string | null {
    try {
      notFoundFor(problem);
      return null;
    } catch (error) {
      return String((error as { digest?: unknown }).digest);
    }
  }

  it('renders the not-found page for request.not_found, any 404 and any 403', () => {
    expect(digestOf({ status: 404, category: 'request', code: 'request.not_found' })).toMatch(/404/);
    expect(digestOf({ category: 'request', code: 'request.not_found' })).toMatch(/404/);
    expect(digestOf({ status: 404, category: 'request', code: 'request.gone_elsewhere' })).toMatch(/404/);
    expect(digestOf({ status: 403, category: 'request', code: 'request.cross_origin' })).toMatch(/404/);
    expect(digestOf({ status: 403, category: 'request', code: 'request.rejected' })).toMatch(/404/);
  });

  it('returns for any other problem', () => {
    expect(digestOf({ status: 400, category: 'request', code: 'request.invalid' })).toBeNull();
    expect(digestOf({ status: 500, category: 'server', code: 'server.unexpected' })).toBeNull();
    expect(digestOf(null)).toBeNull();
    expect(digestOf('request.not_found')).toBeNull();
  });
});
