/**
 * The shell's icons, inline and decorative: the control that holds one names it (`aria-label` or text). Stroked; from
 * Story 3.12 an icon may also be filled with the same colour (a set bookmark).
 */
function Icon({ path, size = 24, filled = false }: { readonly path: string; readonly size?: number; readonly filled?: boolean }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width={size} height={size}>
      <path
        d={path}
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronLeftIcon() {
  return <Icon path="M15 5l-7 7 7 7" />;
}

export function ChevronRightIcon() {
  return <Icon path="M9 5l7 7-7 7" />;
}

/** Usability pass: the handle's icon on a phone, where it is a menu button at the top left. */
export function MenuIcon() {
  return <Icon path="M4 7h16M4 12h16M4 17h16" />;
}

export function UploadIcon() {
  return <Icon path="M12 16V4M7 9l5-5 5 5M5 20h14" />;
}

/** Story 2.7: the source view's close control. */
export function CloseIcon() {
  return <Icon path="M6 6l12 12M18 6L6 18" />;
}

/*
 * The usability pass (2026-11-21): one stroke icon per sidebar entry and per kind of row, the arrows of a page header
 * and a menu, and the marks of a notification. All decorative: the text beside each one names it.
 */
export type IconName =
  | 'questions'
  | 'rules'
  | 'campaigns'
  | 'systems'
  | 'characters'
  | 'files'
  | 'file'
  | 'back'
  | 'chevronDown'
  | 'forward'
  | 'previous'
  | 'bell'
  | 'view'
  | 'list'
  | 'grid'
  | 'eye'
  | 'check'
  | 'warning'
  | 'error'
  | 'info'
  | 'send'
  | 'settings'
  | 'sun'
  | 'moon'
  | 'picture'
  | 'signOut'
  | 'search'
  | 'dismiss'
  | 'bookmark'
  | 'bookmarkFilled'
  | 'fullScreen'
  | 'fullScreenExit'
  | 'zoomIn'
  | 'zoomOut'
  | 'shield';

const PATHS: Readonly<Record<IconName, string>> = {
  questions: 'M4 5h16v11H9l-5 4z',
  rules: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6',
  campaigns: 'M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2zM9 4v14M15 6v14',
  systems: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11',
  characters: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  files: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  file: 'M7 3h7l5 5v13H7zM14 3v5h5',
  back: 'M19 12H5M11 6l-6 6 6 6',
  chevronDown: 'M6 9l6 6 6-6',
  forward: 'M9 6l6 6-6 6',
  previous: 'M15 6l-6 6 6 6',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  view: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 5v4M8 15v4',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  check: 'M5 12l5 5 9-10',
  warning: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  error: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8v5M12 16h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  send: 'M12 19V5M6 11l6-6 6 6',
  settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 5v4M8 15v4',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  picture: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5h.01',
  signOut: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h9',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  /** Story 3.11: an answer's dismiss action, an X drawn inside its filled circle. */
  dismiss: 'M7 7l10 10M17 7L7 17',
  /** Story 3.12: the bookmark of an answer and of the saved items: a ribbon with a notch, outlined. */
  bookmark: 'M7 4h10v16l-5-4-5 4z',
  /** Story 3.12: the same ribbon filled: a saved answer's bookmark. */
  bookmarkFilled: 'M7 4h10v16l-5-4-5 4z',
  /** 2026-11-23: the page view's full screen: four corners pointing out, and pointing in to leave it. */
  fullScreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  fullScreenExit: 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5',
  /** 2026-11-23: a page's zoom: a magnifier with a plus, and with a minus. */
  zoomIn: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M8 11h6M11 8v6',
  zoomOut: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M8 11h6',
  // Story 6.1: a Shield (Escudo do Mestre).
  shield: 'M12 3l8 3v6c0 4.5-3.4 7.8-8 9-4.6-1.2-8-4.5-8-9V6z',
};

/** Story 3.12: the icons drawn filled as well as stroked. */
const FILLED: ReadonlySet<IconName> = new Set<IconName>(['bookmarkFilled']);

/** An icon by its name, 20px unless a size is given. */
export function NamedIcon({ name, size = 20 }: { readonly name: IconName; readonly size?: number }) {
  return <Icon path={PATHS[name]} size={size} filled={FILLED.has(name)} />;
}
