import { describe, expect, it } from 'vitest';
import { classifyAll, classifyOsmElement } from './osmClassify';
import type { OsmElement } from './types';

// Synthetic in-memory OSM elements only. Nothing here is real data or touches a database.
const node = (id: number, tags: Record<string, string>, extra: Partial<OsmElement> = {}): OsmElement => ({
  type: 'node', id, lat: 44.5, lon: -109.0, tags, ...extra,
});
const rec = (el: OsmElement, opts = {}) => {
  const c = classifyOsmElement(el, opts);
  return c.kind === 'record' ? c.record : null;
};
const skip = (el: OsmElement, opts = {}) => {
  const c = classifyOsmElement(el, opts);
  return c.kind === 'skip' ? c.reason : null;
};

describe('explicit evidence (public unverified)', () => {
  it('amenity=toilets with no access restriction is explicit', () => {
    const r = rec(node(1, { amenity: 'toilets' }));
    expect(r?.evidence).toBe('explicit');
    expect(r?.name).toBe('Public restroom');
    expect(r?.source_reference).toBe('node/1');
    expect(r?.source).toBe('osm');
    expect(r?.source_license).toBe('ODbL-1.0');
    expect(r?.source_attribution).toContain('OpenStreetMap');
  });

  it('public/permissive access stays explicit; customers-only is explicit with purchase required', () => {
    expect(rec(node(2, { amenity: 'toilets', access: 'permissive' }))?.evidence).toBe('explicit');
    const c = rec(node(3, { amenity: 'toilets', access: 'customers' }));
    expect(c?.evidence).toBe('explicit');
    expect(c?.purchase_required).toBe(true);
  });

  it('toilets=yes with explicit public toilets:access is explicit', () => {
    const r = rec(node(4, { amenity: 'cafe', name: 'Cafe', toilets: 'yes', 'toilets:access': 'yes' }));
    expect(r?.evidence).toBe('explicit');
    expect(r?.name).toBe('Cafe');
  });
});

describe('inferred evidence (hidden candidate)', () => {
  it('toilets=yes without access info is only a candidate', () => {
    expect(rec(node(5, { amenity: 'cafe', name: 'Cafe', toilets: 'yes' }))?.evidence).toBe('inferred');
  });

  it('place types that often have restrooms are candidates, never explicit', () => {
    expect(rec(node(6, { amenity: 'fuel', name: 'Gas' }))?.evidence).toBe('inferred');
    expect(rec(node(7, { highway: 'rest_area', name: 'Rest area' }))?.evidence).toBe('inferred');
    expect(rec(node(8, { tourism: 'information', information: 'visitor_centre', name: 'Visitors' }))?.evidence).toBe('inferred');
  });

  it('a business existing is not evidence: ordinary businesses are not imported at all', () => {
    for (const tags of [{ amenity: 'restaurant', name: 'R' } as Record<string, string>, { amenity: 'cafe', name: 'C' }, { shop: 'supermarket', name: 'S' }, { amenity: 'bar', name: 'B' }]) {
      expect(skip(node(9, tags))).toBe('not-relevant');
    }
  });

  it('unnamed candidates are skipped; candidates can be disabled', () => {
    expect(skip(node(10, { amenity: 'fuel' }))).toBe('unnamed-candidate');
    expect(skip(node(11, { amenity: 'fuel', name: 'Gas' }), { includeCandidates: false })).toBe('not-relevant');
    expect(skip(node(12, { amenity: 'cafe', name: 'C', toilets: 'yes' }), { includeCandidates: false })).toBe('candidates-disabled');
  });
});

describe('exclusions', () => {
  it('skips private and restricted access', () => {
    for (const access of ['private', 'no', 'permit', 'delivery']) {
      expect(skip(node(20, { amenity: 'toilets', access }))).toBe('restricted-access');
    }
    expect(skip(node(21, { amenity: 'cafe', name: 'C', toilets: 'yes', 'toilets:access': 'private' }))).toBe('restricted-access');
    expect(skip(node(22, { amenity: 'fuel', name: 'G', access: 'private' }))).toBe('restricted-access');
  });

  it('skips residential buildings, disused features, missing tags and missing coordinates', () => {
    expect(skip(node(30, { amenity: 'toilets', building: 'house' }))).toBe('residential-building');
    expect(skip(node(31, { amenity: 'toilets', disused: 'yes' }))).toBe('disused');
    expect(skip({ type: 'node', id: 32, lat: 1, lon: 1 })).toBe('no-tags');
    expect(skip({ type: 'node', id: 33, tags: { amenity: 'toilets' } })).toBe('no-coordinates');
    expect(skip(node(34, { amenity: 'toilets' }, { lat: 200 }))).toBe('no-coordinates');
  });
});

describe('field mapping', () => {
  it('maps ways via center and rounds coordinates', () => {
    const r = rec({ type: 'way', id: 40, center: { lat: 44.1234567891, lon: -109.1234567891 }, tags: { amenity: 'toilets' } });
    expect(r?.source_reference).toBe('way/40');
    expect(r?.latitude).toBe(44.123457);
  });

  it('maps amenities, keeping unknown as null', () => {
    const r = rec(node(41, { amenity: 'toilets', wheelchair: 'yes', unisex: 'yes', changing_table: 'no' }));
    expect(r?.wheelchair_accessible).toBe(true);
    expect(r?.gender_neutral).toBe(true);
    expect(r?.baby_changing).toBe(false);
    expect(r?.key_required).toBeNull();
    expect(rec(node(42, { amenity: 'toilets', wheelchair: 'limited' }))?.wheelchair_accessible).toBeNull();
    expect(rec(node(43, { amenity: 'toilets' }))?.wheelchair_accessible).toBeNull();
  });

  it('builds address and country, defaulting country from options', () => {
    const r = rec(node(44, { amenity: 'toilets', 'addr:housenumber': '1', 'addr:street': 'Main St', 'addr:city': 'Cody', 'addr:state': 'WY', 'addr:postcode': '82414' }));
    expect(r).toMatchObject({ address_line: '1 Main St', city: 'Cody', region: 'WY', postal_code: '82414', country_code: 'US' });
    expect(rec(node(45, { amenity: 'toilets' }), { defaultCountry: 'ca' })?.country_code).toBe('CA');
    expect(rec(node(46, { amenity: 'toilets', 'addr:country': 'mx' }))?.country_code).toBe('MX');
  });

  it('drops unlisted tags such as contact details', () => {
    const r = rec(node(47, { amenity: 'toilets', 'contact:phone': '555', email: 'a@b.c', note: 'x' }));
    expect(Object.keys(r!.source_tags)).toEqual(['amenity']);
  });
});

describe('hash and de-duplication', () => {
  it('hash is stable and changes when source-derived fields change', () => {
    const a = rec(node(50, { amenity: 'toilets', wheelchair: 'yes' }))!;
    const same = rec(node(50, { wheelchair: 'yes', amenity: 'toilets' }))!;
    const changed = rec(node(50, { amenity: 'toilets', wheelchair: 'no' }))!;
    expect(a.source_hash).toBe(same.source_hash);
    expect(a.source_hash).not.toBe(changed.source_hash);
  });

  it('classifyAll de-duplicates by reference and summarizes', () => {
    const els = [node(60, { amenity: 'toilets' }), node(60, { amenity: 'toilets' }), node(61, { amenity: 'fuel', name: 'G' }), node(62, { amenity: 'bar', name: 'B' })];
    const s = classifyAll(els);
    expect(s.records.map((r) => r.source_reference)).toEqual(['node/60', 'node/61']);
    expect(s.skipped['not-relevant']).toBe(1);
  });
});
