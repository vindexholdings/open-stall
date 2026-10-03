import type { Bbox } from './types';

/**
 * Named areas are conveniences only; any bounding box works via --bbox. Boxes are APPROXIMATE
 * and meant for validation, not boundaries of record.
 */
export const AREA_PRESETS: Record<string, { label: string; bbox: Bbox }> = {
  'cody-area': {
    label: 'Cody, Wyoming area (validation area)',
    bbox: { south: 44.45, west: -109.25, north: 44.62, east: -108.85 },
  },
  'big-horn-basin': {
    label: 'Big Horn Basin, Wyoming (approximate)',
    bbox: { south: 43.7, west: -109.9, north: 45.0, east: -107.6 },
  },
};

export function validateBbox(b: Bbox): Bbox {
  const ok =
    [b.south, b.west, b.north, b.east].every(Number.isFinite) &&
    b.south >= -90 && b.north <= 90 && b.west >= -180 && b.east <= 180 &&
    b.south < b.north && b.west < b.east;
  if (!ok) throw new Error('Invalid bounding box (need south<north, west<east within lat/lng limits).');
  return b;
}

/** Parses "south,west,north,east". */
export function parseBbox(text: string): Bbox {
  const parts = text.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 4) throw new Error('--bbox needs south,west,north,east');
  const [south, west, north, east] = parts as [number, number, number, number];
  return validateBbox({ south, west, north, east });
}

/** Splits a box into tiles no larger than maxDegrees per side so Overpass requests stay small. */
export function splitBbox(b: Bbox, maxDegrees = 0.25): Bbox[] {
  const rows = Math.ceil((b.north - b.south) / maxDegrees);
  const cols = Math.ceil((b.east - b.west) / maxDegrees);
  const dLat = (b.north - b.south) / rows;
  const dLng = (b.east - b.west) / cols;
  const tiles: Bbox[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push({
        south: b.south + r * dLat,
        north: b.south + (r + 1) * dLat,
        west: b.west + c * dLng,
        east: b.west + (c + 1) * dLng,
      });
    }
  }
  return tiles;
}
