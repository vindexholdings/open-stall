import { stateFromPermission, type LocationAccessState } from '@open-stall/domain';
import * as Location from 'expo-location';
import { useCallback, useState } from 'react';

/**
 * Foreground location access. Position is held in memory only and never stored or sent
 * anywhere. `request` asks permission if needed, then reads the current position.
 */
export function useUserLocation() {
  const [state, setState] = useState<LocationAccessState>({ kind: 'needs-prompt' });

  const request = useCallback(async () => {
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (permission.status === 'undetermined' || (permission.status === 'denied' && permission.canAskAgain)) {
        permission = await Location.requestForegroundPermissionsAsync();
      }
      const next = stateFromPermission(permission.status, permission.canAskAgain);
      setState(next);
      if (next.kind !== 'locating') return;

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setState({
        kind: 'ready',
        coordinates: { latitude: position.coords.latitude, longitude: position.coords.longitude },
      });
    } catch {
      setState({ kind: 'unavailable' });
    }
  }, []);

  return { state, request };
}
