import {
  applyFilters,
  DEFAULT_FILTERS,
  estimateTravelMinutes,
  formatDistance,
  nearestVerifiedContext,
  verificationBadge,
  type LocationFilters,
} from '@open-stall/domain';
import { colors, radii, spacing, touchTarget, typography } from '@open-stall/ui';
import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { FilterPanel } from '../components/FilterPanel';
import { LocationList, type LocationListItem } from '../components/LocationList';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { locationSource } from '../data';
import { LocationNotice } from '../location/LocationNotice';
import { useNearbyLocations } from '../location/useNearbyLocations';
import { useUserLocation } from '../location/useUserLocation';
import { MapView, type MapMarker } from '../map';

export default function NearbyScreen() {
  const router = useRouter();
  const { state, request } = useUserLocation();
  const openLocation = useCallback(
    (id: string) => router.push({ pathname: '/location/[id]', params: { id } }),
    [router],
  );
  const origin = state.kind === 'ready' ? state.coordinates : null;
  const [filters, setFilters] = useState<LocationFilters>(DEFAULT_FILTERS);
  const nearby = useNearbyLocations(locationSource, origin, {
    radiusMeters: filters.radiusMeters,
    verifiedOnly: filters.verifiedOnly,
  });
  const results = useMemo(
    () => applyFilters(nearby.state.locations, filters),
    [nearby.state.locations, filters],
  );

  // Distance-first ranking is preserved; when the nearest shown result is Unverified, say where the
  // nearest Verified option is (from the visible list, else the server lookup).
  const verifiedHint = useMemo(() => {
    const ctx = nearestVerifiedContext(results);
    if (ctx.kind === 'in-list') {
      return { id: ctx.location.id, name: ctx.location.name, distanceMeters: ctx.location.distanceMeters };
    }
    return ctx.kind === 'lookup' ? nearby.state.nearestVerified : null;
  }, [results, nearby.state.nearestVerified]);

  const markers = useMemo<MapMarker[]>(
    () => results.map((l) => ({ id: l.id, coordinates: l.coordinates, label: l.verification === 'unverified' ? `${l.name} (unverified)` : l.name,
        variant: l.verification,
      })),
    [results],
  );
  const items = useMemo<LocationListItem[]>(
    () =>
      results.map((l) => ({
        id: l.id,
        name: l.name,
        badge: verificationBadge(l),
        subtitle: [l.addressLine, l.city].filter(Boolean).join(', ') || undefined,
        distanceLabel: `${formatDistance(l.distanceMeters)} · ~${estimateTravelMinutes(l.distanceMeters, 'walk')} min walk`,
      })),
    [results],
  );

  const emptyMessage = !locationSource
    ? 'Restroom data isn’t connected in this build.'
    : nearby.state.status === 'error'
      ? 'We couldn’t load restrooms. Check your connection and try again.'
      : nearby.state.status === 'loading'
        ? 'Looking for restrooms…'
        : nearby.state.locations.length > 0
          ? 'No restrooms match your filters. Try clearing some.'
          : 'No restrooms found nearby yet.';

  return (
    <Screen title="Open Stall">
      <Text style={styles.body}>Find the nearest usable restroom fast.</Text>
      {state.kind === 'needs-prompt' ? (
        <PrimaryButton
          label="Find Nearest Restroom"
          onPress={() => void request()}
          accessibilityHint="Asks to use your location to find restrooms near you."
        />
      ) : null}
      <LocationNotice state={state} onRetry={() => void request()} />
      {origin ? (
        <>
          {nearby.state.fromCache ? (
            <Text style={styles.offline} accessibilityLiveRegion="polite">
              You’re offline. Showing saved restrooms, which may be out of date.
            </Text>
          ) : null}
          <FilterPanel filters={filters} onChange={setFilters} />
          <MapView
            center={origin}
            userLocation={origin}
            markers={markers}
            onSelectMarker={openLocation}
          />
          {verifiedHint && results.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Nearest verified restroom: ${verifiedHint.name}, ${formatDistance(verifiedHint.distanceMeters)}`}
              onPress={() => openLocation(verifiedHint.id)}
              style={styles.hint}
            >
              <Text style={styles.hintText}>
                {`Nearest verified: ${formatDistance(verifiedHint.distanceMeters)} · ${verifiedHint.name}`}
              </Text>
            </Pressable>
          ) : null}
          <LocationList
            items={items}
            emptyMessage={emptyMessage}
            onSelect={openLocation}
          />
          {nearby.state.status === 'error' ? (
            <PrimaryButton label="Try again" onPress={nearby.refresh} />
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { ...typography.body, color: colors.textMuted },
  offline: { ...typography.label, color: colors.status.pending.fg },
  hint: {
    minHeight: touchTarget.min,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.status.verified.bg,
    borderWidth: 1,
    borderColor: colors.status.verified.fg,
  },
  hintText: { ...typography.label, color: colors.status.verified.fg },
});
