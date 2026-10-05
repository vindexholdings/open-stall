import type { Coordinates } from '@open-stall/domain';

export type MapMarker = {
  id: string;
  coordinates: Coordinates;
  label: string;
  selected?: boolean;
  /** Unverified markers use a distinct color; the label also says so (never color alone). */
  variant?: 'verified' | 'unverified';
};

/**
 * Provider-neutral map contract. Screens depend only on this; implementations
 * (MapView.web.tsx, MapView.native.tsx) can be swapped without touching them.
 */
export type MapViewProps = {
  center: Coordinates;
  userLocation?: Coordinates;
  markers: MapMarker[];
  onSelectMarker?: (id: string) => void;
  height?: number;
};
