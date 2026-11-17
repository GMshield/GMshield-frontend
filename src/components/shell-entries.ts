/**
 * The sidebar's entries in their order, each with its page, and "Adicionar Arquivo" at the bottom, which opens the
 * guided upload rather than a page (Story 1.14). In a module
 * of its own: the server (the shell, the pages) and the client sidebar both read it, and a value exported from
 * a client module would reach the server only as a reference.
 */
export const SIDEBAR_ENTRIES = [
  { key: 'questions', href: '/questions' },
  { key: 'rules', href: '/rules' },
  { key: 'campaigns', href: '/campaigns' },
  { key: 'systems', href: '/systems' },
  { key: 'characters', href: '/characters' },
  { key: 'files', href: '/files' },
] as const;

export const ADD_FILE = { key: 'addFile' } as const;

/** An entry with a page of its own. */
export type PageEntryKey = (typeof SIDEBAR_ENTRIES)[number]['key'];

export type EntryKey = PageEntryKey | typeof ADD_FILE.key;

/**
 * Marks the shell's parts behind the sidebar (the context bar and main column, a right panel): the sidebar makes
 * them inert while it is open over them, under 1280px.
 */
export const BEHIND_SIDEBAR = 'data-behind-sidebar';
