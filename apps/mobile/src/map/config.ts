export type TileConfig = {
  urlTemplate: string;
  attribution: string;
  maxZoom: number;
};

/**
 * Raster tile source, configurable so no provider is hard-wired.
 * Default is the public OpenStreetMap tile server, which is acceptable for development
 * only (https://operations.osmfoundation.org/policies/tiles/). Set EXPO_PUBLIC_MAP_TILE_URL
 * (and attribution) to an approved provider before any production release.
 */
export const tileConfig: TileConfig = {
  urlTemplate:
    process.env.EXPO_PUBLIC_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution:
    process.env.EXPO_PUBLIC_MAP_ATTRIBUTION ??
    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
};

/** Where the native map page loads Leaflet from. */
export type LeafletAssets = { cssUrl: string; jsUrl: string; integrity: { css: string; js: string } | null };

const LEAFLET_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4';
/** sha256 of Leaflet 1.9.4's dist/leaflet.css and dist/leaflet.js (identical to the npm package and Leaflet's published values). */
const LEAFLET_SRI = { css: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=', js: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=' };

/**
 * The native map is a WebView page that loads Leaflet. By default it comes from the cdnjs CDN and is pinned with
 * subresource integrity, so a tampered or substituted file is refused. For local QA only, EXPO_PUBLIC_LEAFLET_BASE_URL
 * (for example the QA mock server's /leaflet) serves the same files without any third-party request; no integrity pin
 * is applied then.
 */
export const leafletAssets: LeafletAssets = (() => {
  const base = process.env.EXPO_PUBLIC_LEAFLET_BASE_URL?.replace(/\/$/, '');
  return base
    ? { cssUrl: `${base}/leaflet.css`, jsUrl: `${base}/leaflet.js`, integrity: null }
    : { cssUrl: `${LEAFLET_CDN}/leaflet.css`, jsUrl: `${LEAFLET_CDN}/leaflet.js`, integrity: LEAFLET_SRI };
})();

export const DEFAULT_ZOOM = 14;
