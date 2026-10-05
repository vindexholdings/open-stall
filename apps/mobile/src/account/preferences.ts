import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_PREFERENCES, sanitizePreferences, type Preferences } from '@open-stall/domain';
import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { fetchPreferences, savePreferences } from './api';

const KEY = 'open-stall:preferences:v1';
let current: Preferences = DEFAULT_PREFERENCES;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Local-first: preferences work (and persist on-device) without an account. The display name is account-only. */
async function loadLocal() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      current = { ...sanitizePreferences(JSON.parse(raw)), displayName: null };
      emit();
    }
  } catch {
    /* corrupt or unavailable storage: keep defaults */
  }
}

export function usePreferences() {
  const { rpc } = useAuth();
  const prefs = useSyncExternalStore(subscribe, () => current, () => current);

  useEffect(() => {
    void loadLocal();
  }, []);

  // On sign-in, the server copy wins so preferences follow the account across devices.
  useEffect(() => {
    if (!rpc) return;
    let cancelled = false;
    void fetchPreferences(rpc).then((r) => {
      if (cancelled || !r.ok) return;
      current = r.preferences;
      emit();
      void AsyncStorage.setItem(KEY, JSON.stringify({ ...r.preferences, displayName: null })).catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  /** Applies immediately and on-device; syncs to the account when signed in. Returns an error message if the sync failed. */
  async function update(next: Preferences): Promise<string | null> {
    const prev = current;
    current = next;
    emit();
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify({ ...next, displayName: null }));
    } catch {
      /* non-fatal */
    }
    if (!rpc) return null;
    const r = await savePreferences(rpc, next);
    if (!r.ok) {
      current = { ...prev, mode: next.mode, transport: next.transport }; // keep the on-device choice, revert only the rejected name
      emit();
      return r.message;
    }
    return null;
  }

  return { prefs, update, signedIn: rpc !== null };
}
