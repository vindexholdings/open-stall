import { ATTESTATION_TEXT, EMPTY_DRAFT, buildProposal, type LocationDraft } from '@open-stall/domain';
import { colors, radii, spacing, typography } from '@open-stall/ui';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { submitEdit, submitNewLocation } from '../account/api';
import { useAuth } from '../auth/AuthProvider';
import { RequireAuth } from '../auth/RequireAuth';
import { Chip } from '../components/Chip';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { SecondaryButton } from '../components/SecondaryButton';
import { TextField } from '../components/TextField';
import { useUserLocation } from '../location/useUserLocation';

type Tri = boolean | null;
const TRI: { label: string; value: Tri }[] = [
  { label: 'Not sure', value: null },
  { label: 'Yes', value: true },
  { label: 'No', value: false },
];

function TriField({ label, value, onChange }: { label: string; value: Tri; onChange: (v: Tri) => void }) {
  return (
    <View style={styles.tri}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {TRI.map((t) => (
          <Chip key={t.label} role="radio" label={t.label} selected={value === t.value} onPress={() => onChange(t.value)} />
        ))}
      </View>
    </View>
  );
}

function Form({ editId, editName }: { editId: string | null; editName: string | null }) {
  const { rpc } = useAuth();
  const { state: access, request } = useUserLocation();
  const [d, setD] = useState<LocationDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const set = <K extends keyof LocationDraft>(k: K, v: LocationDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const isEdit = editId !== null;

  if (done) {
    return (
      <View style={styles.stack} accessibilityLiveRegion="polite">
        <Text style={styles.body}>Thank you. Your {isEdit ? 'suggestion' : 'restroom'} was sent for review. It won’t appear to others until a person has checked it.</Text>
      </View>
    );
  }

  const setPinHere = async () => {
    const here = access.kind === 'ready' ? access : await request();
    if (here.kind === 'ready') setD((x) => ({ ...x, latitude: here.coordinates.latitude, longitude: here.coordinates.longitude }));
  };

  const submit = async () => {
    const built = buildProposal(d, isEdit ? 'edit' : 'new');
    if (!built.ok) return setErrors(built.errors);
    if (!rpc) return;
    setErrors([]);
    setBusy(true);
    const r = isEdit ? await submitEdit(rpc, editId, built.proposed, built.note) : await submitNewLocation(rpc, built.proposed, built.note);
    setBusy(false);
    if (r.ok) setDone(true);
    else setErrors([r.message]);
  };

  return (
    <View style={styles.stack}>
      <Text style={styles.body}>
        {isEdit
          ? `Only fill in what should change for ${editName ?? 'this restroom'}. Leave the rest blank.`
          : 'Add a restroom the public can use. We review every submission before it is shown.'}
      </Text>
      <TextField label={isEdit ? 'Name (if wrong)' : 'Name of the place'} value={d.name} onChangeText={(v) => set('name', v)} autoCapitalize="words" maxLength={120} />
      <TextField label="Street address" value={d.addressLine} onChangeText={(v) => set('addressLine', v)} autoCapitalize="words" maxLength={300} />
      <TextField label="City" value={d.city} onChangeText={(v) => set('city', v)} autoCapitalize="words" maxLength={120} />
      <TextField label="State" value={d.region} onChangeText={(v) => set('region', v)} autoCapitalize="characters" maxLength={120} />
      <TextField label="ZIP code" value={d.postalCode} onChangeText={(v) => set('postalCode', v)} maxLength={20} />
      <TextField label="Where inside is it? (optional)" value={d.accessLocation} onChangeText={(v) => set('accessLocation', v)} autoCapitalize="sentences" maxLength={300} />
      <TextField label="Hours (optional)" value={d.openingHours} onChangeText={(v) => set('openingHours', v)} maxLength={300} hint="For example: Mo-Su 06:00-22:00" />
      <TriField label="Free to use?" value={d.fee === null ? null : !d.fee} onChange={(v) => set('fee', v === null ? null : !v)} />
      <TriField label="Need a key or code?" value={d.key} onChange={(v) => set('key', v)} />
      <TriField label="Must you buy something?" value={d.purchase} onChange={(v) => set('purchase', v)} />
      <TriField label="Wheelchair accessible?" value={d.wheelchair} onChange={(v) => set('wheelchair', v)} />
      <TriField label="Gender neutral?" value={d.genderNeutral} onChange={(v) => set('genderNeutral', v)} />
      <TriField label="Baby changing table?" value={d.babyChanging} onChange={(v) => set('babyChanging', v)} />

      {!isEdit || d.latitude !== null ? null : (
        <Text style={styles.hint}>Only set a position if the map pin is wrong, and only while standing at the restroom.</Text>
      )}
      <SecondaryButton label={d.latitude === null ? 'Use my current position' : 'Position set. Tap to update'} onPress={() => void setPinHere()}
        accessibilityHint="Uses your device location once to set the pin. Nothing else is shared." />
      {d.latitude !== null && d.longitude !== null ? <Text style={styles.hint}>Pin: {d.latitude.toFixed(5)}, {d.longitude.toFixed(5)}</Text> : null}
      {access.kind === 'denied' ? <Text style={styles.hint}>Location access is off, so the pin can’t be set from here.</Text> : null}

      <TextField label="Note for the reviewer (optional)" value={d.note} onChangeText={(v) => set('note', v)} autoCapitalize="sentences" multiline maxLength={300}
        hint="No links, emails or phone numbers." />

      <View style={styles.attest} accessibilityRole="alert">
        <Chip label={ATTESTATION_TEXT} selected={d.attestedPublic} onPress={() => set('attestedPublic', !d.attestedPublic)} />
      </View>
      {errors.length ? (
        <View accessibilityRole="alert">
          {errors.map((e) => (
            <Text key={e} style={styles.error}>{e}</Text>
          ))}
        </View>
      ) : null}
      <PrimaryButton label={busy ? 'Sending…' : isEdit ? 'Send suggestion' : 'Send restroom for review'} disabled={busy} onPress={() => void submit()} />
    </View>
  );
}

export default function ContributeScreen() {
  const p = useLocalSearchParams<{ id?: string; name?: string }>();
  const editId = typeof p.id === 'string' && /^[0-9a-f-]{36}$/i.test(p.id) ? p.id : null;
  const editName = typeof p.name === 'string' ? p.name.slice(0, 120) : null;
  return (
    <Screen title={editId ? 'Suggest a correction' : 'Add a restroom'}>
      <RequireAuth reason="Sign in to add or correct restrooms. This helps us keep the map trustworthy." next={editId ? `/contribute?id=${editId}` : '/contribute'}>
        <Form key={editId ?? 'new'} editId={editId} editName={editName} />
      </RequireAuth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  tri: { gap: spacing.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  label: { ...typography.label, color: colors.text },
  body: { ...typography.body, color: colors.text },
  hint: { ...typography.label, fontWeight: '400', color: colors.textMuted },
  error: { ...typography.body, color: colors.status.danger.fg },
  attest: { padding: spacing.sm, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
});
