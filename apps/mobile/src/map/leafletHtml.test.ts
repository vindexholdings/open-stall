/// <reference types="node" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { leafletAssets, tileConfig, type LeafletAssets } from './config';
import { buildLeafletHtml, parseSelectMessage } from './leafletHtml';

const cdn: LeafletAssets = { cssUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css', jsUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js', integrity: { css: 'sha256-AAAA', js: 'sha256-BBBB' } };
const colors = { marker: '#0B63C4', selected: '#00776E', unverified: '#92400E', user: '#111827' };

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
      cdn,
    );
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('\\u003c/script\\u003e');
    expect((html.match(/<script/g) ?? []).length).toBe(2); // leaflet.js + inline
  });
});

describe('buildLeafletHtml assets', () => {
  const props = { center: { latitude: 1, longitude: 2 }, markers: [] };
  it('pins the CDN files with subresource integrity', () => {
    const html = buildLeafletHtml(props, tileConfig, 14, colors, cdn);
    expect(html).toContain('integrity="sha256-AAAA" crossorigin="anonymous"');
    expect(html).toContain('integrity="sha256-BBBB" crossorigin="anonymous"');
  });
  it('serves the files from a local QA base without any third-party host and without a pin', () => {
    const local: LeafletAssets = { cssUrl: 'http://10.0.2.2:54800/leaflet/leaflet.css', jsUrl: 'http://10.0.2.2:54800/leaflet/leaflet.js', integrity: null };
    const html = buildLeafletHtml(props, tileConfig, 14, colors, local);
    expect(html).toContain('http://10.0.2.2:54800/leaflet/leaflet.js');
    expect(html).not.toContain('cdnjs.cloudflare.com');
    expect(html).not.toContain('integrity=');
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

describe('default Leaflet assets', () => {
  it('are pinned to the exact files of the installed Leaflet package', () => {
    const dist = createRequire(import.meta.url).resolve('leaflet/dist/leaflet.js').replace(/leaflet\.js$/, '');
    const sri = (f: string) => `sha256-${createHash('sha256').update(readFileSync(dist + f)).digest('base64')}`;
    // (the test environment sets no EXPO_PUBLIC_LEAFLET_BASE_URL, so the defaults apply)
    expect(leafletAssets.integrity).toEqual({ css: sri('leaflet.css'), js: sri('leaflet.js') });
    expect(leafletAssets.jsUrl).toBe('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js');
  });
});
