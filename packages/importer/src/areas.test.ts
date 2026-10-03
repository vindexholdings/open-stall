import { describe, expect, it } from 'vitest';
import { AREA_PRESETS, parseBbox, splitBbox, validateBbox } from './areas';

describe('areas', () => {
  it('presets are valid boxes', () => {
    for (const p of Object.values(AREA_PRESETS)) expect(() => validateBbox(p.bbox)).not.toThrow();
  });

  it('parses and validates arbitrary boxes (not tied to one geography)', () => {
    expect(parseBbox('40,-100,41,-99')).toEqual({ south: 40, west: -100, north: 41, east: -99 });
    expect(() => parseBbox('41,-100,40,-99')).toThrow();
    expect(() => parseBbox('1,2,3')).toThrow();
    expect(() => parseBbox('a,b,c,d')).toThrow();
    expect(() => parseBbox('0,0,91,1')).toThrow();
  });

  it('splits into tiles that cover the box without exceeding the tile size', () => {
    const box = { south: 0, west: 0, north: 1, east: 0.6 };
    const tiles = splitBbox(box, 0.25);
    expect(tiles).toHaveLength(4 * 3);
    expect(Math.min(...tiles.map((t) => t.south))).toBe(0);
    expect(Math.max(...tiles.map((t) => t.north))).toBeCloseTo(1);
    expect(Math.max(...tiles.map((t) => t.east))).toBeCloseTo(0.6);
    for (const t of tiles) {
      expect(t.north - t.south).toBeLessThanOrEqual(0.25 + 1e-9);
      expect(t.east - t.west).toBeLessThanOrEqual(0.25 + 1e-9);
    }
  });
});
