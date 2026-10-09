import {
  applyFilters,
  communityRatingText,
  countActiveFilters,
  DEFAULT_FILTERS,
  estimateTravelMinutes,
  formatDistance,
  nearestVerifiedContext,
  quickFacts,
  resultsSummary,
  verificationBadge,
  type LocationFilters,
} from '@open-stall/domain';
import { colors, layout, layoutFor, radii, spacing, touchTarget, typography } from '@open-stall/ui';
import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { useFocusStyle } from '../components/focus';
import { FilterPanel } from '../components/FilterPanel';
import { LocationList, type LocationListItem } from '../components/LocationList';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { SecondaryButton } from '../components/SecondaryButton';
import { SegmentedControl } from '../components/SegmentedControl';
import { StatusBanner } from '../components/StatusBanner';
import { locationSource } from '../data';
import { LocationNotice } from '../location/LocationNotice';
import { useNearbyLocations } from '../location/useNearbyLocations';
import { useUserLocation } from '../location/useUserLocation';
import { MapView, type MapMarker } from '../map';

type ResultsView = 'list' | 'map';
const VIEW_OPTIONS = [
  { value: 'list', label: 'List' },
  { value: 'map', label: 'Map' },
] as const;

function VerifiedHint({ id, name, distance, onOpen }: { id: string; name: string; distance: string; onOpen: (id: string) => void }) {
  const focus = useFocusStyle();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Nearest verified restroom: ${name}, ${distance}`}
      onPress={() => onOpen(id)}
      {...focus.handlers}
      style={[styles.hint, focus.style]}
    >
      <Text style={styles.hintText}>{`Nearest verified: ${distance} · ${name}`}</Text>
    </Pressable>
  );
}

export default function NearbyScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = layoutFor(width) === 'wide';
  const { state, request } = useUserLocation();
  const [view, setView] = useState<ResultsView>('list');
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
  const activeFilters = countActiveFilters(filters);

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
      results.map((l, i) => ({
        id: l.id,
        name: l.name,
        badge: verificationBadge(l),
        subtitle: [l.addressLine, l.city].filter(Boolean).join(', ') || undefined,
        distance: formatDistance(l.distanceMeters),
        travel: `~${estimateTravelMinutes(l.distanceMeters, 'walk')} min walk`,
        facts: quickFacts(l),
        ratingText: communityRatingText(l.averageRating, l.ratingCount) ?? undefined,
        tag: i === 0 ? 'Nearest' : undefined,
      })),
    [results],
  );

  const loading = nearby.state.status === 'loading';
  const failed = nearby.state.status === 'error';

  // Recovery-oriented notices for every non-list state. None of them hides the location/filters controls.
  const notices = origin ? (
    <>
      {nearby.state.fromCache ? (
        <StatusBanner tone="warning" title="You’re offline" message="Showing saved restrooms, which may be out of date." />
      ) : null}
      {!locationSource ? (
        <StatusBanner tone="info" title="Restroom data isn’t connected" message="Restroom data isn’t connected in this build." />
      ) : null}
      {failed ? (
        <StatusBanner tone="danger" urgent title="We couldn’t load restrooms" message="Check your connection and try again.">
          <PrimaryButton label="Try again" onPress={nearby.refresh} />
        </StatusBanner>
      ) : null}
      {loading ? <StatusBanner tone="info" title="Looking for restrooms…" /> : null}
    </>
  ) : null;

  const empty =
    origin && locationSource && !loading && !failed && results.length === 0 ? (
      nearby.state.locations.length > 0 ? (
        <StatusBanner tone="info" title="No restrooms match your filters" message="Try removing a filter to see more restrooms.">
          <SecondaryButton label="Clear all filters" onPress={() => setFilters(DEFAULT_FILTERS)} />
        </StatusBanner>
      ) : (
        <StatusBanner tone="info" title="No restrooms found nearby yet" message="Open Stall doesn’t list a public restroom within this distance yet.">
          <SecondaryButton label="Check again" onPress={nearby.refresh} />
        </StatusBanner>
      )
    ) : null;

  const list = results.length > 0 ? <LocationList items={items} emptyMessage="" onSelect={openLocation} /> : null;
  const map = origin ? (
    <MapView
      center={origin}
      userLocation={origin}
      markers={markers}
      onSelectMarker={openLocation}
      height={wide ? layout.mapWideHeight : 360}
    />
  ) : null;
  const sticky: ViewStyle | null =
    Platform.OS === 'web' ? ({ position: 'sticky', top: spacing.md } as unknown as ViewStyle) : null;

  const controls = origin ? (
    <>
      <Text
        accessibilityRole="header"
        aria-level={2}
        accessibilityLiveRegion="polite"
        style={styles.summary}
      >
        {loading ? 'Searching…' : resultsSummary(results.length, activeFilters)}
      </Text>
      {verifiedHint && results.length > 0 ? (
        <VerifiedHint id={verifiedHint.id} name={verifiedHint.name} distance={formatDistance(verifiedHint.distanceMeters)} onOpen={openLocation} />
      ) : null}
      <FilterPanel filters={filters} onChange={setFilters} />
      {notices}
    </>
  ) : null;

  return (
    <Screen title="Open Stall" subtitle="Find the nearest usable restroom fast.">
      <LocationNotice state={state} onRetry={() => void request()} />
      {origin ? (
        wide ? (
          <View style={styles.wideRow}>
            <View style={styles.wideList}>
              {controls}
              {empty}
              {list}
            </View>
            <View style={[styles.wideMap, sticky]}>{map}</View>
          </View>
        ) : (
          <>
            {controls}
            <SegmentedControl label="Results view" options={VIEW_OPTIONS} value={view} onChange={setView} />
            {view === 'map' ? map : null}
            {empty}
            {view === 'list' ? list : null}
          </>
        )
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: { ...typography.heading, color: colors.text },
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
  wideRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg },
  wideList: { flex: 1, minWidth: 360, gap: spacing.md },
  wideMap: { flex: 1.3 },
});
