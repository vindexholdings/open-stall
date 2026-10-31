import { stateFromPermission, type LocationAccessState } from '@open-stall/domain';
import * as Location from 'expo-location';
import { useSyncExternalStore } from 'react';

/**
 * Foreground location access shared across screens via a tiny in-memory store, so the detail
 * screen can show distance without re-prompting or putting coordinates in URLs. Position is
 * held in memory only and never stored or sent anywhere.
 */
let current: LocationAccessState = { kind: 'needs-prompt' };
const listeners = new Set<() => void>();

function set(next: LocationAccessState) {
  current = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function request(): Promise<LocationAccessState> {
  try {
    let permission = await Location.getForegroundPermissionsAsync();
    if (permission.status === 'undetermined' || (permission.status === 'denied' && permission.canAskAgain)) {
      permission = await Location.requestForegroundPermissionsAsync();
    }
    const next = stateFromPermission(permission.status, permission.canAskAgain);
    set(next);
    if (next.kind !== 'locating') return current;

    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    set({
      kind: 'ready',
      coordinates: { latitude: position.coords.latitude, longitude: position.coords.longitude },
    });
  } catch {
    set({ kind: 'unavailable' });
  }
  return current;
}

export function useUserLocation() {
  const state = useSyncExternalStore(subscribe, () => current, () => current);
  return { state, request };
}
