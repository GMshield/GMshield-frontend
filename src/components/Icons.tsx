/** The shell's icons, inline and decorative: the control that holds one names it (`aria-label` or text). */
function Icon({ path }: { readonly path: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="24" height="24">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronLeftIcon() {
  return <Icon path="M15 5l-7 7 7 7" />;
}

export function ChevronRightIcon() {
  return <Icon path="M9 5l7 7-7 7" />;
}

export function UploadIcon() {
  return <Icon path="M12 16V4M7 9l5-5 5 5M5 20h14" />;
}
