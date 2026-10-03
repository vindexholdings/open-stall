import { describe, expect, it } from 'vitest';
import { tileConfig } from './config';
import { buildLeafletHtml, parseSelectMessage } from './leafletHtml';

const colors = { marker: '#0B63C4', selected: '#00776E', user: '#111827' };

describe('buildLeafletHtml', () => {
  it('escapes hostile labels so they cannot break out of the script', () => {
    const html = buildLeafletHtml(
      {
        center: { latitude: 1, longitude: 2 },
        markers: [
          { id: 'a', coordinates: { latitude: 1, longitude: 2 }, label: '</script><script>alert(1)</script>' },
        ],
      },
      tileConfig,
      14,
      colors,
    );
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('\\u003c/script\\u003e');
    expect((html.match(/<script/g) ?? []).length).toBe(2); // leaflet.js + inline
  });
});

describe('parseSelectMessage', () => {
  it('accepts only well-formed select messages', () => {
    expect(parseSelectMessage('{"type":"select","id":"abc"}')).toBe('abc');
    expect(parseSelectMessage('{"type":"select","id":5}')).toBeNull();
    expect(parseSelectMessage('{"type":"other","id":"abc"}')).toBeNull();
    expect(parseSelectMessage('not json')).toBeNull();
  });
});
