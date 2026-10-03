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

export const DEFAULT_ZOOM = 14;
