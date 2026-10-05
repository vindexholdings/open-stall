import type { LocationFix } from '@open-stall/domain';
import * as Location from 'expo-location';

export type FixResult = { ok: true; fix: LocationFix } | { ok: false; message: string };

/**
 * One fresh, high-accuracy device reading for contributions that must be made from where the person is standing.
 * It is returned to the caller only: nothing is stored, cached or logged here.
 */
export async function getCurrentFix(timeoutMs = 20_000): Promise<FixResult> {
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') {
      return { ok: false, message: 'Location access is off. Allow it in your device or browser settings so we can place the restroom where you are.' };
    }
    const position = await Promise.race([
      // expo-location's web build defaults to maximumAge: Infinity (a cached reading, possibly from elsewhere);
      // force a new reading. Native ignores the extra field.
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High, maximumAge: 0 } as Location.LocationOptions),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    const { latitude, longitude, accuracy } = position.coords;
    // Use the reading's own timestamp so a cached/old fix is recognised as stale by fixProblem().
    const capturedAt = Number.isFinite(position.timestamp) && position.timestamp > 0 ? position.timestamp : Date.now();
    return { ok: true, fix: { latitude, longitude, accuracyM: accuracy ?? Number.NaN, capturedAt } };
  } catch {
    return { ok: false, message: 'We couldn’t get your location. Move near open sky and try again.' };
  }
}
