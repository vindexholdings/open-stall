import {
  CHECKIN_RADIUS_METERS, OBSERVATIONS, ratingChoiceLabel, toggleObservation, validateRating,
  type ObservationKey, type PublicLocation,
} from '@open-stall/domain';
import { colors, radii, spacing, typography } from '@open-stall/ui';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { addFavorite, checkIn, deleteMyReview, fetchMyReview, removeFavorite, submitReview, listFavorites } from '../account/api';
import { usePreferences } from '../account/preferences';
import { RequireAuth } from '../auth/RequireAuth';
import { useAuth } from '../auth/AuthProvider';
import { useUserLocation } from '../location/useUserLocation';
import { Chip } from './Chip';
import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';

type Notice = { text: string; error: boolean } | null;

/** Signed-in actions for one restroom. Discovery above this component never depends on it. */
export function LocationActions({ location }: { location: PublicLocation }) {
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>Your actions</Text>
      <RequireAuth reason="Sign in to save this restroom, rate it, check in, or suggest a fix. Finding restrooms never needs an account." next={`/location/${location.id}`}>
        <Signed location={location} />
      </RequireAuth>
    </View>
  );
}

function Signed({ location }: { location: PublicLocation }) {
  const { rpc } = useAuth();
  const router = useRouter();
  const { prefs } = usePreferences();
  const { state: access, request } = useUserLocation();
  const [saved, setSaved] = useState<boolean | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [obs, setObs] = useState<ObservationKey[]>([]);
  const [hasReview, setHasReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    if (!rpc) return;
    let cancelled = false;
    void (async () => {
      const [favs, mine] = await Promise.all([listFavorites(rpc, null), fetchMyReview(rpc, location.id)]);
      if (cancelled) return;
      if (favs.ok) setSaved(favs.locations.some((l) => l.id === location.id));
      if (mine.ok && mine.review) {
        setRating(mine.review.rating);
        setObs(mine.review.observations);
        setHasReview(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rpc, location.id]);

  if (!rpc) return null;
  const act = async (fn: () => Promise<{ ok: boolean; message?: string }>, success: string, after?: () => void) => {
    setBusy(true);
    setNotice(null);
    const r = await fn();
    setBusy(false);
    setNotice(r.ok ? { text: success, error: false } : { text: r.message ?? 'Something went wrong. Please try again.', error: true });
    if (r.ok) after?.();
  };

  const toggleSaved = () =>
    saved
      ? act(() => removeFavorite(rpc, location.id), 'Removed from favorites.', () => setSaved(false))
      : act(() => addFavorite(rpc, location.id), 'Saved to favorites.', () => setSaved(true));

  const rate = () => {
    const bad = validateRating(rating);
    if (bad) return setNotice({ text: bad, error: true });
    return act(() => submitReview(rpc, location.id, rating!, prefs.mode, obs), 'Thanks. Your rating was saved.', () => { setHasReview(true); });
  };

  const doCheckIn = async () => {
    const here = access.kind === 'ready' ? access : await request();
    if (here.kind !== 'ready') {
      return setNotice({ text: 'We need your location to confirm you’re at the restroom. Your position isn’t stored.', error: true });
    }
    await act(() => checkIn(rpc, location.id, here.coordinates), 'Checked in. Thanks!');
  };

  return (
    <View style={styles.stack}>
      <PrimaryButton
        label={saved ? 'Remove from favorites' : 'Save to favorites'}
        disabled={busy || saved === null}
        onPress={() => void toggleSaved()}
      />

      <Text accessibilityRole="header" style={styles.sub}>Rate this restroom</Text>
      <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <Chip key={n} role="radio" label={ratingChoiceLabel(n, prefs.mode)} selected={rating === n} onPress={() => setRating(n)} />
        ))}
      </View>
      <View style={styles.row} accessibilityLabel="What did you notice? Optional">
        {OBSERVATIONS.map((o) => (
          <Chip key={o.key} label={o.label} selected={obs.includes(o.key)} onPress={() => setObs((s) => toggleObservation(s, o.key))} />
        ))}
      </View>
      <PrimaryButton label={hasReview ? 'Update my rating' : 'Save rating'} disabled={busy} onPress={() => void rate()} />
      {hasReview ? (
        <SecondaryButton
          label="Remove my rating"
          disabled={busy}
          onPress={() => void act(() => deleteMyReview(rpc, location.id), 'Your rating was removed.', () => { setHasReview(false); setRating(null); setObs([]); })}
        />
      ) : null}

      <SecondaryButton label="I’m here: check in" disabled={busy} onPress={() => void doCheckIn()}
        accessibilityHint={`Confirms you are within ${CHECKIN_RADIUS_METERS} meters of this restroom. Your position is not stored.`} />
      <SecondaryButton label="Suggest a correction" onPress={() => router.push({ pathname: '/contribute', params: { id: location.id, name: location.name } })} />
      <SecondaryButton label="Report a problem" onPress={() => router.push({ pathname: '/report', params: { id: location.id, name: location.name } })} />

      {notice ? <Text style={notice.error ? styles.error : styles.ok} accessibilityRole={notice.error ? 'alert' : undefined} accessibilityLiveRegion="polite">{notice.text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  title: { ...typography.heading, color: colors.text },
  sub: { ...typography.label, color: colors.text, marginTop: spacing.sm },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  error: { ...typography.body, color: colors.status.danger.fg },
  ok: { ...typography.body, color: colors.text },
});
