/**
 * Brings a turn of the conversation on the page to the top of the window and gives it focus (Story 3.12; 2026-11-23 for
 * a saved item's "Ir" to an answer already on the page). A turn takes focus from the page only (`tabindex="-1"`), never
 * from the keyboard's Tab. Under 1280px the saved items panel may still lie over the page for a moment, and nothing
 * behind it takes focus until it is gone: focus is tried again on the next frames, for half a second.
 */
export function showTurn(target: HTMLElement, behavior: ScrollBehavior = 'auto'): void {
  target.scrollIntoView?.({ block: 'start', behavior });
  if (!target.hasAttribute('tabindex')) {
    target.setAttribute('tabindex', '-1');
  }
  let tries = 0;
  const focusIt = () => {
    target.focus({ preventScroll: true });
    if (document.activeElement !== target && target.isConnected && tries < 30) {
      tries += 1;
      requestAnimationFrame(focusIt);
    }
  };
  focusIt();
}
