import {
  FREE_FAVORITES_LIMIT, distanceMeters, estimateTravelMinutes, formatDistance, verificationBadge, type PublicLocation,
} from '@open-stall/domain';
import { colors, spacing, typography } from '@open-stall/ui';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { listFavorites } from '../account/api';
import { RequireAuth } from '../auth/RequireAuth';
import { useAuth } from '../auth/AuthProvider';
import { LocationList } from '../components/LocationList';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { SecondaryButton } from '../components/SecondaryButton';
import { StatusBanner } from '../components/StatusBanner';
import { useUserLocation } from '../location/useUserLocation';

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; items: PublicLocation[] };

function FavoritesList() {
  const { rpc } = useAuth();
  const router = useRouter();
  const { state: access } = useUserLocation();
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(() => {
    if (!rpc) return;
    // Coordinates are NOT sent to the account server: distances are computed here on the device.
    void listFavorites(rpc, null).then((r) => setState(r.ok ? { kind: 'ready', items: r.locations } : { kind: 'error', message: r.message }));
  }, [rpc]);
  useFocusEffect(load);

  if (state.kind === 'loading') return <StatusBanner tone="info" title="Loading your favorites…" />;
  if (state.kind === 'error') {
    return (
      <StatusBanner tone="danger" urgent title="We couldn’t load your favorites." message={state.message}>
        <PrimaryButton label="Try again" onPress={() => { setState({ kind: 'loading' }); load(); }} />
      </StatusBanner>
    );
  }
  const origin = access.kind === 'ready' ? access.coordinates : null;
  if (state.items.length === 0) {
    return (
      <StatusBanner tone="info" title="No favorites yet." message="Open a restroom and choose “Save to favorites”. Favorites sync across your devices.">
        <SecondaryButton label="Find nearby restrooms" onPress={() => router.push('/')} />
      </StatusBanner>
    );
  }
  const full = state.items.length >= FREE_FAVORITES_LIMIT;
  return (
    <View style={styles.stack}>
      <Text style={styles.hint} accessibilityLiveRegion="polite">{state.items.length} of {FREE_FAVORITES_LIMIT} saved</Text>
      {full ? (
        <StatusBanner tone="warning" title="Your favorites are full." message="Open a saved restroom and choose “Remove from favorites” to make room for another." />
      ) : null}
      <LocationList
        emptyMessage="No favorites yet. Open a restroom and choose “Save to favorites”."
        onSelect={(id) => router.push({ pathname: '/location/[id]', params: { id } })}
        items={state.items.map((l) => {
          const m = origin ? distanceMeters(origin, l.coordinates) : null;
          return {
            id: l.id,
            name: l.name,
            badge: verificationBadge(l),
            subtitle: [l.addressLine, l.city].filter(Boolean).join(', ') || undefined,
            distanceLabel: m === null ? undefined : `${formatDistance(m)} · ~${estimateTravelMinutes(m, 'walk')} min walk`,
          };
        })}
      />
    </View>
  );
}

export default function FavoritesScreen() {
  return (
    <Screen title="Favorites" form>
      <RequireAuth reason="Sign in to save favorite restrooms and see them on all your devices." next="/favorites">
        <FavoritesList />
      </RequireAuth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  hint: { ...typography.label, fontWeight: '400', color: colors.textMuted },
});
