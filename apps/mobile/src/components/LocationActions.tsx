import {
  CHECKIN_RADIUS_METERS, OBSERVATIONS, ratingChoiceLabel, toggleObservation, uncertainWriteMessage, validateRating,
  type ObservationKey, type PublicLocation,
} from '@open-stall/domain';
import { colors, spacing, typography } from '@open-stall/ui';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { addFavorite, checkIn, deleteMyReview, fetchMyReview, removeFavorite, submitReview, listFavorites } from '../account/api';
import { usePreferences } from '../account/preferences';
import { RequireAuth } from '../auth/RequireAuth';
import { useAuth } from '../auth/AuthProvider';
import { useUserLocation } from '../location/useUserLocation';
import { Chip } from './Chip';
import { RadioGroup } from './RadioGroup';
import { PrimaryButton } from './PrimaryButton';
import { Section } from './Section';
import { SecondaryButton } from './SecondaryButton';
import { StatusBanner } from './StatusBanner';

type Notice = { text: string; error: boolean; uncertain?: boolean } | null;

/** Signed-in actions for one restroom. Discovery above this component never depends on it. */
export function LocationActions({ location }: { location: PublicLocation }) {
  const router = useRouter();
  return (
    <>
      <Section title="Save, rate and check in">
        <RequireAuth reason="Sign in to save this restroom, rate it, check in, or suggest a fix. Finding restrooms never needs an account." next={`/location/${location.id}`}>
          <Signed location={location} />
        </RequireAuth>
      </Section>
      <Section title="Something wrong?" hint="Corrections and reports are reviewed by a person. Signing in is required so we can keep them trustworthy.">
        <SecondaryButton label="Suggest a correction" onPress={() => router.push({ pathname: '/contribute', params: { id: location.id, name: location.name } })} />
        <SecondaryButton label="Report a problem" onPress={() => router.push({ pathname: '/report', params: { id: location.id, name: location.name } })} />
      </Section>
    </>
  );
}

function Signed({ location }: { location: PublicLocation }) {
  const { rpc } = useAuth();
  const { prefs } = usePreferences();
  const { state: access, request } = useUserLocation();
  const [saved, setSaved] = useState<boolean | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [obs, setObs] = useState<ObservationKey[]>([]);
  const [hasReview, setHasReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [statusProblem, setStatusProblem] = useState(false); // could not check whether this restroom is already saved
  const [attempt, setAttempt] = useState(0);
  // A synchronous lock: `busy` only updates after a render, so a fast double tap could otherwise send twice.
  const inFlight = useRef(false);

  useEffect(() => {
    if (!rpc) return;
    let cancelled = false;
    void (async () => {
      const [favs, mine] = await Promise.all([listFavorites(rpc, null), fetchMyReview(rpc, location.id)]);
      if (cancelled) return;
      setStatusProblem(!favs.ok);
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
  }, [rpc, location.id, attempt]);

  if (!rpc) return null;
  const act = async (fn: () => Promise<{ ok: boolean; message?: string; uncertain?: boolean }>, success: string, uncertainWhat: string, after?: () => void) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    let r: { ok: boolean; message?: string; uncertain?: boolean };
    try {
      r = await fn();
    } catch {
      r = { ok: false, uncertain: true };
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
    setNotice(
      r.ok
        ? { text: success, error: false }
        : r.uncertain
          ? { text: uncertainWriteMessage(uncertainWhat), error: true, uncertain: true }
          : { text: r.message ?? 'Something went wrong. Please try again.', error: true },
    );
    if (r.ok) after?.();
  };

  const toggleSaved = () =>
    saved
      ? act(() => removeFavorite(rpc, location.id), 'Removed from favorites.', 'your favorite was removed', () => setSaved(false))
      : act(() => addFavorite(rpc, location.id), 'Saved to favorites.', 'your favorite was saved', () => setSaved(true));

  const rate = () => {
    const bad = validateRating(rating);
    if (bad) return setNotice({ text: bad, error: true });
    return act(() => submitReview(rpc, location.id, rating!, prefs.mode, obs), 'Thanks. Your rating was saved.', 'your rating was saved', () => { setHasReview(true); });
  };

  const doCheckIn = async () => {
    if (inFlight.current) return;
    let here = access;
    if (here.kind !== 'ready') {
      inFlight.current = true;
      setBusy(true);
      try {
        here = await request();
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    }
    if (here.kind !== 'ready') {
      return setNotice({ text: 'We need your location to confirm you’re at the restroom. Your position isn’t stored.', error: true });
    }
    const coordinates = here.coordinates;
    await act(() => checkIn(rpc, location.id, coordinates), 'Checked in. Thanks!', 'your check-in was recorded');
  };

  return (
    <View style={styles.stack}>
      {notice ? (
        notice.uncertain ? (
          <StatusBanner tone="warning" urgent title="Not confirmed" message={notice.text} />
        ) : (
          <StatusBanner tone={notice.error ? 'danger' : 'success'} urgent={notice.error} title={notice.text} />
        )
      ) : null}

      {statusProblem ? (
        <StatusBanner tone="warning" title="We couldn’t check your favorites" message="Saving is paused until we can tell whether this restroom is already saved.">
          <SecondaryButton label="Check again" onPress={() => setAttempt((n) => n + 1)} />
        </StatusBanner>
      ) : null}

      <PrimaryButton
        label={saved ? 'Remove from favorites' : 'Save to favorites'}
        disabled={busy || saved === null}
        onPress={() => void toggleSaved()}
      />

      <Text accessibilityRole="header" aria-level={3} style={styles.sub}>Rate this restroom</Text>
      <RadioGroup
        label="Rating"
        options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: ratingChoiceLabel(n, prefs.mode) }))}
        value={rating}
        onChange={setRating}
      />
      <View role="group" aria-label="What did you notice? Optional" style={styles.row}>
        {OBSERVATIONS.map((o) => (
          <Chip key={o.key} label={o.label} selected={obs.includes(o.key)} onPress={() => setObs((s) => toggleObservation(s, o.key))} />
        ))}
      </View>
      <PrimaryButton label={busy ? 'Saving…' : hasReview ? 'Update my rating' : 'Save rating'} disabled={busy} onPress={() => void rate()} />
      {hasReview ? (
        <SecondaryButton
          label="Remove my rating"
          disabled={busy}
          onPress={() => void act(() => deleteMyReview(rpc, location.id), 'Your rating was removed.', 'your rating was removed', () => { setHasReview(false); setRating(null); setObs([]); })}
        />
      ) : null}

      <Text accessibilityRole="header" aria-level={3} style={styles.sub}>Are you here?</Text>
      <SecondaryButton label="I’m here: check in" disabled={busy} onPress={() => void doCheckIn()}
        accessibilityHint={`Confirms you are within ${CHECKIN_RADIUS_METERS} meters of this restroom. Your position is not stored.`} />
    </View>
  );
}

const styles = StyleSheet.create({
  sub: { ...typography.label, color: colors.text, marginTop: spacing.sm },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
