/**
 * The web view's own right-click menu, switched off.
 *
 * A right-click anywhere in this window used to offer Back, Reload, View Page
 * Source and Save Image As. None of it does anything here, half of it does
 * something alarming, and all of it announces that the application is a web
 * page wearing a window — which is the one thing an application should never
 * have to admit.
 *
 * Installed on the document in the capture phase, so it has already refused
 * before React's own handlers run. The canvas opens Dialect's menu from its
 * bubble-phase handler, and that is the only place in the window where a
 * right-click means anything at all.
 */

export function refuseWebMenu(): void {
  document.addEventListener('contextmenu', (e) => e.preventDefault(), { capture: true });
}
