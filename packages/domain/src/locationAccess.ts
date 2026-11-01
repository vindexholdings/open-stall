import type { Coordinates } from './geo';

export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

/**
 * UI-facing state of device location access. Precise coordinates live only in this
 * in-memory state; they are never persisted (SECURITY.md).
 */
export type LocationAccessState =
  | { kind: 'needs-prompt' }
  | { kind: 'locating' }
  | { kind: 'ready'; coordinates: Coordinates }
  | { kind: 'denied'; canAskAgain: boolean }
  | { kind: 'unavailable' };

/** Maps an OS permission response to the next state before any position is read. */
export function stateFromPermission(
  status: PermissionStatus,
  canAskAgain: boolean,
): LocationAccessState {
  switch (status) {
    case 'granted':
      return { kind: 'locating' };
    case 'denied':
      return { kind: 'denied', canAskAgain };
    default:
      return { kind: 'needs-prompt' };
  }
}
