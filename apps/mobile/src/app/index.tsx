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
  searchLocations,
  buildNavigationUrl,
  type TravelMode,
  verificationBadge,
  type LocationFilters,
} from '@open-stall/domain';
import { colors, layout, layoutFor, radii, spacing, touchTarget, typography } from '@open-stall/ui';
import { getDiscoverySession, saveDiscoverySession, type ResultsView } from '../state/discoverySession';
import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Linking, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { usePreferences } from '../account/preferences';
import { NearestCard, QuickActions, ResultSearch, type QuickAction } from '../components/Dashboard';
import { enterActivates, useFocusStyle } from '../components/focus';
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
      {...enterActivates(() => onOpen(id))}
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
  const [view, setViewState] = useState<ResultsView>(() => getDiscoverySession().view);
  const setView = useCallback((next: ResultsView) => {
    saveDiscoverySession({ view: next });
    setViewState(next);
  }, []);
  const openLocation = useCallback(
    (id: string) => router.push({ pathname: '/location/[id]', params: { id } }),
    [router],
  );
  const origin = state.kind === 'ready' ? state.coordinates : null;
  const [query, setQueryState] = useState<string>(() => getDiscoverySession().query);
  const setQuery = useCallback((next: string) => {
    saveDiscoverySession({ query: next });
    setQueryState(next);
  }, []);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { prefs } = usePreferences();
  const [filters, setFiltersState] = useState<LocationFilters>(() => getDiscoverySession().filters);
  const setFilters = useCallback((next: LocationFilters) => {
    saveDiscoverySession({ filters: next });
    setFiltersState(next);
  }, []);
  const nearby = useNearbyLocations(locationSource, origin, {
    radiusMeters: filters.radiusMeters,
    verifiedOnly: filters.verifiedOnly,
  });
  const filtered = useMemo(
    () => applyFilters(nearby.state.locations, filters),
    [nearby.state.locations, filters],
  );
  // Search narrows what is already loaded (name, street, town); it never looks anything up.
  const results = useMemo(() => searchLocations(filtered, query), [filtered, query]);
  const searching = query.trim().length > 0;
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

  const nearest = results[0];
  const nearestItem = nearest
    ? {
        id: nearest.id,
        name: nearest.name,
        distance: formatDistance(nearest.distanceMeters),
        travel: `~${estimateTravelMinutes(nearest.distanceMeters, 'walk')} min walk`,
        badge: verificationBadge(nearest),
        facts: quickFacts(nearest),
        subtitle: [nearest.addressLine, nearest.city].filter(Boolean).join(', ') || undefined,
      }
    : null;
  const directions = () => {
    if (!nearest) return;
    const mode: TravelMode = prefs.transport;
    const url = buildNavigationUrl(Platform.OS === 'ios' ? 'apple' : 'google', nearest.coordinates, mode);
    if (url) void Linking.openURL(url);
  };
  const quickActions: QuickAction[] = [
    ...(origin && !wide
      ? [{ key: 'view', label: view === 'map' ? 'Show list' : 'Show map', hint: view === 'map' ? 'Back to the list' : 'See restrooms on a map', icon: view === 'map' ? 'list' : 'map', tone: 'blue', kind: 'button', onPress: () => setView(view === 'map' ? 'list' : 'map') } satisfies QuickAction]
      : []),
    ...(origin
      ? [{ key: 'filters', label: activeFilters ? `Filters (${activeFilters})` : 'Filters', hint: filtersOpen ? 'Hide the filter options' : 'Narrow by access and rating', icon: 'filter', tone: 'teal', kind: 'button', expanded: filtersOpen, onPress: () => setFiltersOpen((v) => !v) } satisfies QuickAction]
      : []),
    { key: 'favorites', label: 'Favorites', hint: 'Your saved restrooms', icon: 'heart', tone: 'rose', kind: 'link', onPress: () => router.navigate('/favorites') },
    { key: 'add', label: 'Add a restroom', hint: 'Help others find one', icon: 'plus', tone: 'amber', kind: 'link', onPress: () => router.navigate('/contribute') },
  ];

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
      filtered.length > 0 && searching ? (
        <StatusBanner tone="info" title={`No restrooms match “${query.trim()}”`} message="Check the spelling, or search for part of the name or street.">
          <SecondaryButton label="Clear search" onPress={() => setQuery('')} />
        </StatusBanner>
      ) : nearby.state.locations.length > 0 ? (
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
      <ResultSearch value={query} onChange={setQuery} />
      <Text
        accessibilityRole="header"
        aria-level={2}
        accessibilityLiveRegion="polite"
        style={styles.summary}
      >
        {loading ? 'Searching…' : searching ? (results.length === 0 ? `No restrooms match “${query.trim()}”` : `${results.length} ${results.length === 1 ? 'restroom matches' : 'restrooms match'} “${query.trim()}”`) : resultsSummary(results.length, activeFilters)}
      </Text>
      {verifiedHint && results.length > 0 ? (
        <VerifiedHint id={verifiedHint.id} name={verifiedHint.name} distance={formatDistance(verifiedHint.distanceMeters)} onOpen={openLocation} />
      ) : null}
      <FilterPanel filters={filters} onChange={setFilters} open={filtersOpen} onOpenChange={setFiltersOpen} />
      {notices}
    </>
  ) : null;

  // Nearest-restroom hero and quick actions. Phones: above everything. Wide: the top of the left column, beside the map.
  const top = (
    <>
      {origin && nearestItem ? <NearestCard item={nearestItem} onDirections={directions} onOpen={openLocation} narrowed={searching || activeFilters > 0} /> : null}
      <QuickActions actions={quickActions} />
    </>
  );

  return (
    <Screen title="Open Stall" subtitle="Find the nearest usable restroom fast.">
      <LocationNotice state={state} onRetry={() => void request()} />
      {!wide ? top : null}
      {origin ? (
        wide ? (
          <View style={styles.wideRow}>
            <View style={styles.wideList}>
              {top}
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
