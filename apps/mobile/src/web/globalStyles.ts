import { focusRing } from '@open-stall/ui';

const CSS = `
/* Tab labels stay whole at 320 px / 400% zoom: the navigator's 5 px side padding left "Nearby" 2 px too narrow. */
a[role="tab"] { padding-left: 0 !important; padding-right: 0 !important; }
a[role="tab"] div { overflow: visible !important; text-overflow: clip !important; max-width: none !important; }
/* Keyboard focus for the tab bar links (rendered by the navigator, outside our components). */
a[role="tab"]:focus-visible { outline: ${focusRing.outlineWidth}px solid ${focusRing.outlineColor} !important; outline-offset: -${focusRing.outlineWidth}px !important; }
/* Leaflet map controls: 44 px touch targets and a visible focus indicator (the map itself is focusable for keyboard pan/zoom). */
.leaflet-bar a, .leaflet-touch .leaflet-bar a { width: 44px !important; height: 44px !important; line-height: 44px !important; font-size: 22px !important; }
.leaflet-container:focus-visible, .leaflet-container a:focus-visible { outline: ${focusRing.outlineWidth}px solid ${focusRing.outlineColor} !important; outline-offset: -${focusRing.outlineWidth}px !important; }
`;

/**
 * Web only: the navigator renders the tab bar as a bare tablist outside any landmark, so its links sit outside every
 * region (axe "region"). Mark the bar's wrapper as the main navigation landmark. Retried briefly because the bar mounts
 * after the first render; harmless if the element is not found.
 */
export function labelTabBarLandmark(): () => void {
  if (typeof document === 'undefined') return () => {};
  let tries = 0;
  const apply = () => {
    const list = document.querySelector('[role="tablist"]');
    const bar = list?.parentElement;
    if (bar && bar.getAttribute('role') !== 'navigation') {
      bar.setAttribute('role', 'navigation');
      bar.setAttribute('aria-label', 'Main');
    }
    return !!bar;
  };
  if (apply()) return () => {};
  const timer = setInterval(() => { if (apply() || ++tries > 20) clearInterval(timer); }, 100);
  return () => clearInterval(timer);
}

/** Web only: installs the few global rules that cannot be expressed on our own components. Safe to call more than once. */
export function installGlobalWebStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('open-stall-global-styles')) return;
  const style = document.createElement('style');
  style.id = 'open-stall-global-styles';
  style.textContent = CSS;
  document.head.appendChild(style);
}
