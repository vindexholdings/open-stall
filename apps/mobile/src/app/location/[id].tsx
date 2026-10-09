import {
  buildNavigationUrl,
  communityRatingDetail,
  describeFacts,
  distanceMeters,
  estimateTravelMinutes,
  factMark,
  formatDistance,
  hoursLabel,
  parseLocationId,
  provenanceNotes,
  quickFacts,
  UNVERIFIED_EXPLANATION,
  verificationBadge,
  type Fact,
  type NavigationProvider,
  type PublicLocation,
  type TravelMode,
} from '@open-stall/domain';
import { colors, layoutFor, spacing, typography } from '@open-stall/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { usePreferences } from '../../account/preferences';
import { LocationActions } from '../../components/LocationActions';
import { PrimaryButton } from '../../components/PrimaryButton';
import { RadioGroup } from '../../components/RadioGroup';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { SecondaryButton } from '../../components/SecondaryButton';
import { StatusBanner } from '../../components/StatusBanner';
import { VerificationBadge } from '../../components/VerificationBadge';
import { locationSource } from '../../data';
import { useUserLocation } from '../../location/useUserLocation';

type Load = { id: string; status: 'ready'; location: PublicLocation; fromCache: boolean } | { id: string; status: 'missing' | 'error' };

/** One fact: label, then a symbol + word. Unknown is "? Not reported" and never reads as "No". */
function FactRow({ fact }: { fact: Fact }) {
  const mark = factMark(fact.value);
  return (
    <View role="listitem" style={styles.factRow} accessible accessibilityLabel={`${fact.label}: ${fact.text}`}>
      <Text style={styles.factLabel}>{fact.label}</Text>
      <Text style={[styles.factValue, fact.value === 'unknown' && styles.unknown]}>{`${mark.symbol} ${mark.text}`}</Text>
    </View>
  );
}

function FactList({ label, facts, children }: { label: string; facts: Fact[]; children?: React.ReactNode }) {
  return (
    <View role="list" aria-label={label} style={styles.facts}>
      {facts.map((f) => (
        <FactRow key={f.key} fact={f} />
      ))}
      {children}
    </View>
  );
}

export default function LocationDetail() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = parseLocationId(params.id);
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = layoutFor(width) === 'wide';
  const { prefs } = usePreferences();
  const [chosenMode, setMode] = useState<TravelMode | null>(null);
  const mode: TravelMode = chosenMode ?? prefs.transport;
  const { state: access } = useUserLocation();
  const [load, setLoad] = useState<Load | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!locationSource || !id) return;
    let cancelled = false;
    locationSource
      .getPublicById(id)
      .then(({ location, fromCache }) => {
        if (!cancelled) setLoad(location ? { id, status: 'ready', location, fromCache } : { id, status: 'missing' });
      })
      .catch(() => {
        if (!cancelled) setLoad({ id, status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  const current = load && load.id === id ? load : null;
  const backToSearch = <SecondaryButton label="Find nearby restrooms" onPress={() => router.replace('/')} />;

  if (!id) {
    return (
      <Screen title="Restroom">
        <StatusBanner tone="danger" urgent title="This restroom link isn’t valid." message="Check the link, or search for a restroom near you.">
          {backToSearch}
        </StatusBanner>
      </Screen>
    );
  }
  if (!locationSource) {
    return (
      <Screen title="Restroom">
        <StatusBanner tone="info" title="Restroom data isn’t connected in this build.">{backToSearch}</StatusBanner>
      </Screen>
    );
  }
  if (!current) {
    return (
      <Screen title="Restroom">
        <StatusBanner tone="info" title="Loading restroom details…" />
      </Screen>
    );
  }
  if (current.status === 'missing') {
    return (
      <Screen title="Restroom">
        <StatusBanner tone="warning" title="This restroom isn’t available." message="It may have been removed or hasn’t been confirmed yet.">
          {backToSearch}
        </StatusBanner>
      </Screen>
    );
  }
  if (current.status === 'error') {
    return (
      <Screen title="Restroom">
        <StatusBanner tone="danger" urgent title="We couldn’t load this restroom." message="Check your connection and try again.">
          <PrimaryButton label="Try again" onPress={() => setAttempt((n) => n + 1)} />
          {backToSearch}
        </StatusBanner>
      </Screen>
    );
  }

  if (current.status !== 'ready') return null;
  const l = current.location;
  const origin = access.kind === 'ready' ? access.coordinates : null;
  const meters = origin ? distanceMeters(origin, l.coordinates) : null;
  const { access: accessFacts, amenities } = describeFacts(l);
  const hours = hoursLabel(l.openingHours);
  const rating = communityRatingDetail(l.averageRating, l.ratingCount);
  const highlights = quickFacts(l);
  const navigate = (provider: NavigationProvider) => {
    const url = buildNavigationUrl(provider, l.coordinates, mode);
    if (url) void Linking.openURL(url);
  };
  const address = [l.addressLine, [l.city, l.region].filter(Boolean).join(', '), l.postalCode].filter(Boolean).join(' · ');

  const summary = (
    <View style={styles.summary}>
      {address ? <Text style={styles.body}>{address}</Text> : null}
      {meters !== null ? (
        <Text style={styles.strong} accessibilityLiveRegion="polite">
          {formatDistance(meters)} · ~{estimateTravelMinutes(meters, 'walk')} min walk · ~{estimateTravelMinutes(meters, 'bike')} min bike · ~
          {estimateTravelMinutes(meters, 'drive')} min drive
        </Text>
      ) : null}
      <View style={styles.badges}>
        <VerificationBadge badge={verificationBadge(l)} />
        <Text style={rating.hasRatings ? styles.rating : styles.ratingNone}>{rating.headline}</Text>
      </View>
      {highlights.length > 0 ? (
        <View role="list" aria-label="Quick facts" style={styles.highlights}>
          {highlights.map((h) => (
            <Text key={h} role="listitem" style={styles.highlight}>
              {h}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );

  const main = (
    <>
      <Section title="Access">
        <FactList label="Access facts" facts={accessFacts}>
          <View role="listitem" style={styles.factRow} accessible accessibilityLabel={`Hours: ${hours.text}`}>
            <Text style={styles.factLabel}>Hours</Text>
            <Text style={[styles.hours, !hours.reported && styles.unknown]}>{hours.reported ? hours.text : `? ${hours.text}`}</Text>
          </View>
        </FactList>
        {l.accessLocation ? <Text style={styles.body}>Where: {l.accessLocation}</Text> : null}
      </Section>

      <Section title="Amenities">
        <FactList label="Amenities" facts={amenities} />
      </Section>

      <Section title="About these details" hint={rating.note}>
        {provenanceNotes(l).map((n) => (
          <Text key={n} style={styles.note}>
            {n}
          </Text>
        ))}
      </Section>
    </>
  );

  const getThere = (
    <Section title="Get there">
        <RadioGroup
          label="Travel mode"
          options={[{ value: 'walk', label: 'Walk' }, { value: 'bike', label: 'Bike' }, { value: 'drive', label: 'Drive' }] as const}
          value={mode}
          onChange={setMode}
        />
        <PrimaryButton label="Navigate with Google Maps" onPress={() => navigate('google')} accessibilityHint="Opens directions in Google Maps." />
        {Platform.OS === 'ios' ? (
          <PrimaryButton label="Navigate with Apple Maps" onPress={() => navigate('apple')} accessibilityHint="Opens directions in Apple Maps." />
        ) : null}
      </Section>
  );

  const side = (
    <>
      {getThere}
      <LocationActions location={l} />
    </>
  );

  return (
    <Screen title={l.name}>
      {current.fromCache ? (
        <StatusBanner tone="warning" title="Offline: showing saved details" message="These details may be out of date." />
      ) : null}
      {l.verification === 'unverified' ? (
        <StatusBanner tone="warning" title="Unverified restroom" message={UNVERIFIED_EXPLANATION} />
      ) : null}
      {summary}
      {wide ? (
        <View style={styles.wideRow}>
          <View style={styles.wideMain}>{main}</View>
          <View style={styles.wideSide}>{side}</View>
        </View>
      ) : (
        <>
          {getThere}
          {main}
          <LocationActions location={l} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { ...typography.body, color: colors.textMuted },
  summary: { gap: spacing.sm },
  strong: { ...typography.heading, color: colors.text },
  badges: { gap: spacing.xs },
  rating: { ...typography.body, color: colors.text },
  ratingNone: { ...typography.body, color: colors.textMuted },
  highlights: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  highlight: { ...typography.label, color: colors.text, backgroundColor: colors.surfaceMuted, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 999, overflow: 'hidden' },
  facts: { gap: spacing.xs },
  factRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, minHeight: 32 },
  factLabel: { ...typography.body, color: colors.text, flex: 1 },
  factValue: { ...typography.label, color: colors.text },
  unknown: { color: colors.textMuted, fontWeight: '400' },
  hours: { ...typography.body, color: colors.text, flex: 2, textAlign: 'right' },
  note: { ...typography.body, color: colors.textMuted },
  wideRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg },
  wideMain: { flex: 3, gap: spacing.md },
  wideSide: { flex: 2, gap: spacing.md },
});
