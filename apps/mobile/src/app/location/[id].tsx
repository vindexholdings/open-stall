import {
  buildNavigationUrl,
  communityRatingDetail,
  describeFacts,
  distanceMeters,
  factMark,
  formatDistance,
  hoursLabel,
  parseLocationId,
  provenanceNotes,
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
import { Icon } from '../../components/Icon';
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

/**
 * One feature, written for this restroom's own value ("No key needed", "Hot water available", "Fee not reported"). The
 * mark shows the three states apart: a check (known present), a cross (confirmed absent), a question mark (not reported).
 * The words carry the state, so there is no repeated Yes/No column and nothing relies on color or symbol alone.
 */
function FeatureRow({ fact, muted = false }: { fact: Fact; muted?: boolean }) {
  const mark = factMark(fact.value);
  const quiet = muted || fact.value === 'unknown';
  return (
    <View role="listitem" style={styles.featureRow} accessible accessibilityLabel={fact.label}>
      <Icon name={mark.icon} size={18} color={fact.value === 'unknown' ? colors.textMuted : colors.text} inner={colors.surface} />
      <Text style={[styles.featureText, quiet && styles.unknown]}>{fact.label}</Text>
    </View>
  );
}

function FeatureList({ label, facts, muted = false }: { label: string; facts: Fact[]; muted?: boolean }) {
  return (
    <View role="list" aria-label={label} style={styles.features}>
      {facts.map((f) => (
        <FeatureRow key={f.key} fact={f} muted={muted} />
      ))}
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
      <Screen back="pushed" moveFocus title="Restroom">
        <StatusBanner tone="danger" urgent title="This restroom link isn’t valid." message="Check the link, or search for a restroom near you.">
          {backToSearch}
        </StatusBanner>
      </Screen>
    );
  }
  if (!locationSource) {
    return (
      <Screen back="pushed" moveFocus title="Restroom">
        <StatusBanner tone="info" title="Restroom data isn’t connected in this build.">{backToSearch}</StatusBanner>
      </Screen>
    );
  }
  if (!current) {
    return (
      <Screen back="pushed" moveFocus title="Restroom">
        <StatusBanner tone="info" title="Loading restroom details…" />
      </Screen>
    );
  }
  if (current.status === 'missing') {
    return (
      <Screen back="pushed" moveFocus title="Restroom">
        <StatusBanner tone="warning" title="This restroom isn’t available." message="It may have been removed or hasn’t been confirmed yet.">
          {backToSearch}
        </StatusBanner>
      </Screen>
    );
  }
  if (current.status === 'error') {
    return (
      <Screen back="pushed" moveFocus title="Restroom">
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
  const { access: accessFacts, amenities, secondary } = describeFacts(l);
  const hours = hoursLabel(l.openingHours);
  const rating = communityRatingDetail(l.averageRating, l.ratingCount);
  const navigate = (provider: NavigationProvider) => {
    const url = buildNavigationUrl(provider, l.coordinates, mode);
    if (url) void Linking.openURL(url);
  };
  const address = [l.addressLine, [l.city, l.region].filter(Boolean).join(', '), l.postalCode].filter(Boolean).join(' · ');

  const summary = (
    <View style={styles.summary}>
      {address ? <Text style={styles.body}>{address}</Text> : null}
      {meters !== null ? (
        <View style={styles.iconLine} accessible accessibilityLabel={`${formatDistance(meters)} away, straight-line distance`} accessibilityLiveRegion="polite">
          <Icon name="pin" size={18} color={colors.primaryStrong} inner={colors.background} />
          <Text style={styles.strong}>{formatDistance(meters)}</Text>
          <Text style={styles.body}>straight-line</Text>
        </View>
      ) : null}
      <View style={styles.badges}>
        <VerificationBadge badge={verificationBadge(l)} />
        <View style={styles.iconLine}>
          {rating.hasRatings ? <Icon name="star" size={16} color={colors.text} /> : null}
          <Text style={rating.hasRatings ? styles.rating : styles.ratingNone}>{rating.headline}</Text>
        </View>
      </View>
    </View>
  );

  const main = (
    <>
      <Section title="Features & Access">
        <View style={styles.iconLine} accessible accessibilityLabel={`Hours: ${hours.text}`}>
          <Icon name={hours.reported ? 'clock' : 'help'} size={18} color={hours.reported ? colors.text : colors.textMuted} inner={colors.surface} />
          <Text style={[styles.hours, !hours.reported && styles.unknown]}>{hours.reported ? `Hours: ${hours.text}` : 'Hours not reported'}</Text>
        </View>
        <FeatureList label="Access and features" facts={[...accessFacts, ...amenities]} />
        <FeatureList label="Other details" facts={secondary} muted />
        {l.accessLocation ? <Text style={styles.body}>Where: {l.accessLocation}</Text> : null}
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
    <Screen back="pushed" moveFocus title={l.name}>
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
  iconLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, flexWrap: 'wrap' },
  features: { gap: spacing.xs },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
  featureText: { ...typography.body, color: colors.text, flex: 1 },
  unknown: { color: colors.textMuted, fontWeight: '400' },
  hours: { ...typography.body, color: colors.text, flex: 1 },
  note: { ...typography.body, color: colors.textMuted },
  wideRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg },
  wideMain: { flex: 3, gap: spacing.md },
  wideSide: { flex: 2, gap: spacing.md },
});
