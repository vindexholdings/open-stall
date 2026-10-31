import { focusRing } from '@open-stall/ui';

const CSS = `
/* Keyboard focus for the main navigation links (rendered inside the navigator's own bar). */
nav[aria-label="Main"] a { text-decoration: none; }
nav[aria-label="Main"] a:focus, nav[aria-label="Main"] a:focus-visible { outline: ${focusRing.outlineWidth}px solid ${focusRing.outlineColor} !important; outline-offset: -${focusRing.outlineWidth}px !important; }
/* Fallback: any other keyboard-focused element (for example a scrollable page area that browsers make Tab-focusable) gets a visible ring. Headings only take programmatic focus and show none. */
:focus-visible:not(h1):not(input):not(textarea) { outline: ${focusRing.outlineWidth}px solid ${focusRing.outlineColor}; outline-offset: -${focusRing.outlineWidth}px; }
/* Leaflet map controls: 44 px touch targets and a visible focus indicator (the map itself is focusable for keyboard pan/zoom). */
.leaflet-bar a, .leaflet-touch .leaflet-bar a { width: 44px !important; height: 44px !important; line-height: 44px !important; font-size: 22px !important; }
.leaflet-container:focus-visible, .leaflet-container a:focus-visible { outline: ${focusRing.outlineWidth}px solid ${focusRing.outlineColor} !important; outline-offset: -${focusRing.outlineWidth}px !important; }
`;

/** Web only: installs the few global rules that cannot be expressed on our own components. Safe to call more than once. */
export function installGlobalWebStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('open-stall-global-styles')) return;
  const style = document.createElement('style');
  style.id = 'open-stall-global-styles';
  style.textContent = CSS;
  document.head.appendChild(style);
}
