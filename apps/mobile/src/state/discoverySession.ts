import { DEFAULT_FILTERS, type LocationFilters } from '@open-stall/domain';

export type ResultsView = 'list' | 'map';
type Saved = { filters: LocationFilters; view: ResultsView; query: string };

/**
 * What the user chose on the discovery screen (filters, List | Map, the search text), kept for this app session only. Opening a
 * restroom and coming back remounts the screen; without this the filters and view would silently reset. Nothing is
 * persisted to disk or sent anywhere, and a page reload starts fresh.
 */
let saved: Saved = { filters: DEFAULT_FILTERS, view: 'list', query: '' };

export const getDiscoverySession = (): Saved => saved;
export const saveDiscoverySession = (patch: Partial<Saved>): void => {
  saved = { ...saved, ...patch };
};
/** Test helper: forget the session choices. */
export const resetDiscoverySession = (): void => {
  saved = { filters: DEFAULT_FILTERS, view: 'list', query: '' };
};
