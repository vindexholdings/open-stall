import { colors } from '@open-stall/ui';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { DEFAULT_ZOOM, tileConfig } from './config';
import type { MapViewProps } from './types';

export function MapView({ center, userLocation, markers, onSelectMarker, height = 280 }: MapViewProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const map = L.map(ref.current).setView([center.latitude, center.longitude], DEFAULT_ZOOM);
    L.tileLayer(tileConfig.urlTemplate, {
      attribution: tileConfig.attribution,
      maxZoom: tileConfig.maxZoom,
    }).addTo(map);

    for (const m of markers) {
      const marker = L.circleMarker([m.coordinates.latitude, m.coordinates.longitude], {
        radius: m.selected ? 11 : 9,
        color: '#ffffff',
        weight: 2,
        fillColor: m.selected
          ? colors.accentStrong
          : m.variant === 'unverified'
            ? colors.status.unverified.fg
            : colors.primaryStrong,
        fillOpacity: 1,
      }).addTo(map);
      const label = document.createElement('span');
      label.textContent = m.label;
      marker.bindTooltip(label);
      marker.on('click', () => onSelectMarker?.(m.id));
    }
    if (userLocation) {
      L.circleMarker([userLocation.latitude, userLocation.longitude], {
        radius: 7,
        color: '#ffffff',
        weight: 2,
        fillColor: colors.text,
        fillOpacity: 1,
      }).addTo(map);
    }
    return () => {
      map.remove();
    };
  }, [center, userLocation, markers, onSelectMarker]);

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Map of nearby restrooms. The list below has the same results."
      style={{ height, borderRadius: 16, overflow: 'hidden' }}
    />
  );
}
