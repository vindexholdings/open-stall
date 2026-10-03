import {
  describeFacts,
  distanceMeters,
  estimateTravelMinutes,
  buildNavigationUrl,
  formatDistance,
  parseLocationId,
  ratingLabel,
  verificationLabel,
  type Fact,
  type NavigationProvider,
  type PublicLocation,
  type TravelMode,
} from '@open-stall/domain';
import { colors, radii, spacing, typography } from '@open-stall/ui';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { Chip } from '../../components/Chip';
import { PrimaryButton } from '../../components/PrimaryButton';
import { Screen } from '../../components/Screen';
import { locationSource } from '../../data';
import { useUserLocation } from '../../location/useUserLocation';

type Load = { id: string; status: 'ready'; location: PublicLocation; fromCache: boolean } | { id: string; status: 'missing' | 'error' };

function FactRow({ fact }: { fact: Fact }) {
  return (
    <View style={styles.factRow} accessible accessibilityLabel={`${fact.label}: ${fact.text}`}>
      <Text style={styles.factLabel}>{fact.label}</Text>
      <Text style={[styles.factValue, fact.value === 'unknown' && styles.unknown]}>{fact.text}</Text>
    </View>
  );
}

export default function LocationDetail() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = parseLocationId(params.id);
  const [mode, setMode] = useState<TravelMode>('walk');
  const { state: access } = useUserLocation();
  const [load, setLoad] = useState<Load | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!locationSource || !id) return;
    let cancelled = false;
    locationSource
      .getVerifiedById(id)
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

  if (!id) {
    return (
      <Screen title="Restroom">
        <Text style={styles.body}>This restroom link isn’t valid.</Text>
      </Screen>
    );
  }
  if (!current) {
    return (
      <Screen title="Restroom">
        <Text style={styles.body}>{locationSource ? 'Loading…' : 'Restroom data isn’t connected in this build.'}</Text>
      </Screen>
    );
  }
  if (current.status !== 'ready') {
    return (
      <Screen title="Restroom">
        <Text style={styles.body}>
          {current.status === 'missing' ? 'This restroom isn’t available.' : 'We couldn’t load this restroom.'}
        </Text>
        {current.status === 'error' ? (
          <PrimaryButton label="Try again" onPress={() => setAttempt((n) => n + 1)} />
        ) : null}
      </Screen>
    );
  }

  const l = current.location;
  const origin = access.kind === 'ready' ? access.coordinates : null;
  const meters = origin ? distanceMeters(origin, l.coordinates) : null;
  const { access: accessFacts, amenities } = describeFacts(l);
  const navigate = (provider: NavigationProvider) => {
    const url = buildNavigationUrl(provider, l.coordinates, mode);
    if (url) void Linking.openURL(url);
  };
  const address = [l.addressLine, [l.city, l.region].filter(Boolean).join(', '), l.postalCode]
    .filter(Boolean)
    .join(' · ');

  return (
    <Screen title={l.name}>
      {current.fromCache ? (
        <Text style={styles.offline}>Offline: showing saved details, which may be out of date.</Text>
      ) : null}
      {address ? <Text style={styles.body}>{address}</Text> : null}
      {meters !== null ? (
        <Text style={styles.strong} accessibilityLiveRegion="polite">
          {formatDistance(meters)} · ~{estimateTravelMinutes(meters, 'walk')} min walk · ~
          {estimateTravelMinutes(meters, 'bike')} min bike · ~{estimateTravelMinutes(meters, 'drive')} min drive
        </Text>
      ) : null}
      <View style={styles.badges}>
        <Text style={styles.verified}>{verificationLabel(l.lastVerifiedAt)}</Text>
        <Text style={styles.rating}>{ratingLabel(l.averageRating, l.ratingCount)}</Text>
      </View>

      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Navigate
        </Text>
        <View style={styles.modes} accessibilityRole="radiogroup" accessibilityLabel="Travel mode">
          {(['walk', 'bike', 'drive'] as const).map((m) => (
            <Chip
              key={m}
              role="radio"
              label={m === 'walk' ? 'Walk' : m === 'bike' ? 'Bike' : 'Drive'}
              selected={mode === m}
              onPress={() => setMode(m)}
            />
          ))}
        </View>
        <PrimaryButton
          label="Navigate with Google Maps"
          onPress={() => navigate('google')}
          accessibilityHint="Opens directions in Google Maps."
        />
        {Platform.OS === 'ios' ? (
          <PrimaryButton
            label="Navigate with Apple Maps"
            onPress={() => navigate('apple')}
            accessibilityHint="Opens directions in Apple Maps."
          />
        ) : null}
      </View>

      <Section title="Access">
        {accessFacts.map((f) => (
          <FactRow key={f.key} fact={f} />
        ))}
        {l.accessLocation ? <Text style={styles.body}>Where: {l.accessLocation}</Text> : null}
      </Section>

      <Section title="Amenities">
        {amenities.map((f) => (
          <FactRow key={f.key} fact={f} />
        ))}
      </Section>

      {l.attribution ? <Text style={styles.attribution}>{l.attribution}</Text> : null}
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { ...typography.body, color: colors.textMuted },
  strong: { ...typography.heading, color: colors.text },
  badges: { gap: spacing.xs },
  modes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  verified: { ...typography.label, color: colors.status.verified.fg },
  rating: { ...typography.body, color: colors.text },
  section: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: { ...typography.heading, color: colors.text },
  factRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, minHeight: 32 },
  factLabel: { ...typography.body, color: colors.text, flex: 1 },
  factValue: { ...typography.label, color: colors.text },
  unknown: { color: colors.textMuted, fontWeight: '400' },
  attribution: { ...typography.label, color: colors.textMuted },
  offline: { ...typography.label, color: colors.status.pending.fg },
});
