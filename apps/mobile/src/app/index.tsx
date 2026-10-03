import { estimateTravelMinutes, formatDistance } from '@open-stall/domain';
import { colors, typography } from '@open-stall/ui';
import { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { LocationList, type LocationListItem } from '../components/LocationList';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { locationSource } from '../data';
import { LocationNotice } from '../location/LocationNotice';
import { useNearbyLocations } from '../location/useNearbyLocations';
import { useUserLocation } from '../location/useUserLocation';
import { MapView, type MapMarker } from '../map';

export default function NearbyScreen() {
  const { state, request } = useUserLocation();
  const origin = state.kind === 'ready' ? state.coordinates : null;
  const nearby = useNearbyLocations(locationSource, origin);

  const markers = useMemo<MapMarker[]>(
    () => nearby.state.locations.map((l) => ({ id: l.id, coordinates: l.coordinates, label: l.name })),
    [nearby.state],
  );
  const items = useMemo<LocationListItem[]>(
    () =>
      nearby.state.locations.map((l) => ({
        id: l.id,
        name: l.name,
        subtitle: [l.addressLine, l.city].filter(Boolean).join(', ') || undefined,
        distanceLabel: `${formatDistance(l.distanceMeters)} · ~${estimateTravelMinutes(l.distanceMeters, 'walk')} min walk`,
      })),
    [nearby.state],
  );

  const emptyMessage = !locationSource
    ? 'Restroom data isn’t connected in this build.'
    : nearby.state.status === 'error'
      ? 'We couldn’t load restrooms. Check your connection and try again.'
      : nearby.state.status === 'loading'
        ? 'Looking for restrooms…'
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
          <MapView center={origin} userLocation={origin} markers={markers} />
          <LocationList items={items} emptyMessage={emptyMessage} />
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
});
