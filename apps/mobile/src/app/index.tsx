import {
  applyFilters,
  DEFAULT_FILTERS,
  estimateTravelMinutes,
  formatDistance,
  type LocationFilters,
} from '@open-stall/domain';
import { colors, typography } from '@open-stall/ui';
import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
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
  const nearby = useNearbyLocations(locationSource, origin, filters.radiusMeters);
  const results = useMemo(
    () => applyFilters(nearby.state.locations, filters),
    [nearby.state.locations, filters],
  );

  const markers = useMemo<MapMarker[]>(
    () => results.map((l) => ({ id: l.id, coordinates: l.coordinates, label: l.name })),
    [results],
  );
  const items = useMemo<LocationListItem[]>(
    () =>
      results.map((l) => ({
        id: l.id,
        name: l.name,
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
          : 'No verified restrooms nearby yet.';

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
});
