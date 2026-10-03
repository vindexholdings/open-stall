import type { TileConfig } from './config';
import type { MapViewProps } from './types';

/** JSON that is safe to embed inside an inline <script>. */
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Self-contained Leaflet page for the native WebView. Labels are inserted with
 * textContent, and all data is embedded as escaped JSON, so location names cannot inject markup.
 */
export function buildLeafletHtml(
  props: Pick<MapViewProps, 'center' | 'userLocation' | 'markers'>,
  tiles: TileConfig,
  zoom: number,
  colors: { marker: string; selected: string; user: string },
): string {
  const data = safeJson({ ...props, tiles, zoom, colors });
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css">
<style>html,body,#map{height:100%;margin:0}</style>
</head><body><div id="map"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>
<script>
(function () {
  var d = ${data};
  var map = L.map('map').setView([d.center.latitude, d.center.longitude], d.zoom);
  L.tileLayer(d.tiles.urlTemplate, { attribution: d.tiles.attribution, maxZoom: d.tiles.maxZoom }).addTo(map);
  d.markers.forEach(function (m) {
    var c = m.selected ? d.colors.selected : d.colors.marker;
    var marker = L.circleMarker([m.coordinates.latitude, m.coordinates.longitude],
      { radius: m.selected ? 11 : 9, color: '#ffffff', weight: 2, fillColor: c, fillOpacity: 1 }).addTo(map);
    var el = document.createElement('span');
    el.textContent = m.label;
    marker.bindTooltip(el);
    marker.on('click', function () {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'select', id: m.id }));
    });
  });
  if (d.userLocation) {
    L.circleMarker([d.userLocation.latitude, d.userLocation.longitude],
      { radius: 7, color: '#ffffff', weight: 2, fillColor: d.colors.user, fillOpacity: 1 }).addTo(map);
  }
})();
</script></body></html>`;
}

/** Parses a WebView message; returns the selected marker id or null for anything unexpected. */
export function parseSelectMessage(raw: string): string | null {
  try {
    const msg: unknown = JSON.parse(raw);
    if (
      typeof msg === 'object' &&
      msg !== null &&
      (msg as { type?: unknown }).type === 'select' &&
      typeof (msg as { id?: unknown }).id === 'string'
    ) {
      return (msg as { id: string }).id;
    }
  } catch {
    // ignore malformed messages
  }
  return null;
}
