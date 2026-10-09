import { ATTESTATION_TEXT, EMPTY_DRAFT, buildProposal, fixProblem, type LocationDraft, type LocationFix } from '@open-stall/domain';
import { colors, spacing, typography } from '@open-stall/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { submitEdit, submitNewLocation } from '../account/api';
import { useAuth } from '../auth/AuthProvider';
import { RequireAuth } from '../auth/RequireAuth';
import { Chip } from '../components/Chip';
import { RadioGroup } from '../components/RadioGroup';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { Section } from '../components/Section';
import { SecondaryButton } from '../components/SecondaryButton';
import { StatusBanner } from '../components/StatusBanner';
import { TextField } from '../components/TextField';
import { getCurrentFix } from '../location/currentFix';

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
      <RadioGroup label={label} options={TRI} value={value} onChange={onChange} />
    </View>
  );
}

function Form({ editId, editName }: { editId: string | null; editName: string | null }) {
  const { rpc } = useAuth();
  const router = useRouter();
  const sending = useRef(false); // synchronous lock: a double tap must never send two proposals
  const [d, setD] = useState<LocationDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [done, setDone] = useState(false);
  const set = <K extends keyof LocationDraft>(k: K, v: LocationDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const isEdit = editId !== null;

  if (done) {
    return (
      <StatusBanner
        tone="success"
        title="Thank you."
        message={`Your ${isEdit ? 'suggestion' : 'restroom'} was sent for review. It won’t appear to others until a person has checked it.`}
      >
        {isEdit ? <SecondaryButton label="Back to the restroom" onPress={() => router.replace({ pathname: '/location/[id]', params: { id: editId } })} /> : null}
        <SecondaryButton label="Back to nearby restrooms" onPress={() => router.replace('/')} />
      </StatusBanner>
    );
  }

  const refreshFix = async (): Promise<LocationFix | null> => {
    setLocating(true);
    const r = await getCurrentFix();
    setLocating(false);
    if (!r.ok) {
      setErrors([r.message]);
      return null;
    }
    setD((x) => ({ ...x, fix: r.fix }));
    setErrors([]);
    return r.fix;
  };

  const submit = async () => {
    if (!rpc || sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      // New restrooms must use a FRESH fix taken now, so a stale reading from somewhere else can't be sent.
      let draft = d;
      if (!isEdit && fixProblem(d.fix) !== null) {
        const fresh = await refreshFix();
        if (!fresh) return;
        draft = { ...d, fix: fresh };
      }
      const built = buildProposal(draft, isEdit ? 'edit' : 'new');
      if (!built.ok) return setErrors(built.errors);
      setErrors([]);
      const r = isEdit
        ? await submitEdit(rpc, editId, built.proposed, built.note)
        : await submitNewLocation(rpc, built.proposed, built.position!, built.note);
      if (r.ok) setDone(true);
      else setErrors([r.message]);
    } catch {
      setErrors(['Something went wrong. Nothing was sent. Your answers are still here, so you can try again.']);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const fixMessage = d.fix ? fixProblem(d.fix) : null;

  return (
    <View style={styles.stack}>
      <Text style={styles.body}>
        {isEdit
          ? `Only fill in what should change for ${editName ?? 'this restroom'}. Leave the rest blank.`
          : 'Stand at the restroom to add it. We use your device location once to place it on the map, and we don’t keep a history of where you’ve been. Every submission is reviewed before it is shown.'}
      </Text>

      <Section title="About the place">
        <TextField label={isEdit ? 'Name (if wrong)' : 'Name of the place'} value={d.name} onChangeText={(v) => set('name', v)} autoCapitalize="words" maxLength={120} />
        <TextField label="Street address (optional)" value={d.addressLine} onChangeText={(v) => set('addressLine', v)} autoCapitalize="words" maxLength={300} />
        <TextField label="City (optional)" value={d.city} onChangeText={(v) => set('city', v)} autoCapitalize="words" maxLength={120} />
        <TextField label="State (optional)" value={d.region} onChangeText={(v) => set('region', v)} autoCapitalize="characters" maxLength={120} />
        <TextField label="ZIP code (optional)" value={d.postalCode} onChangeText={(v) => set('postalCode', v)} maxLength={20} />
        <TextField label="Where inside is it? (optional)" value={d.accessLocation} onChangeText={(v) => set('accessLocation', v)} autoCapitalize="sentences" maxLength={300} />
        <TextField label="Hours (optional)" value={d.openingHours} onChangeText={(v) => set('openingHours', v)} maxLength={300} hint="For example: Mo-Su 06:00-22:00" />
      </Section>

      <Section title="Access and facilities" hint="“Not sure” is a fine answer. It is saved as unknown, not as “No”.">
        <TriField label="Free to use?" value={d.fee === null ? null : !d.fee} onChange={(v) => set('fee', v === null ? null : !v)} />
        <TriField label="Need a key or code?" value={d.key} onChange={(v) => set('key', v)} />
        <TriField label="Must you buy something?" value={d.purchase} onChange={(v) => set('purchase', v)} />
        <TriField label="Wheelchair accessible?" value={d.wheelchair} onChange={(v) => set('wheelchair', v)} />
        <TriField label="Gender neutral?" value={d.genderNeutral} onChange={(v) => set('genderNeutral', v)} />
        <TriField label="Baby changing table?" value={d.babyChanging} onChange={(v) => set('babyChanging', v)} />
      </Section>

      <Section
        title={isEdit ? 'Wrong pin? (optional)' : 'Location'}
        hint={isEdit
          ? 'Only use this if you are standing at the restroom and its pin on the map is wrong.'
          : 'The restroom is placed at your current position. You can’t pick a different spot.'}
      >
        <SecondaryButton
          label={locating ? 'Getting your location…' : d.fix ? 'Refresh my location' : isEdit ? 'Use my current position for the pin' : 'Use my current location'}
          disabled={locating || busy}
          onPress={() => void refreshFix()}
          accessibilityHint="Uses your device location once. Nothing else is shared."
        />
        {d.fix ? (
          fixMessage ? (
            <StatusBanner tone="warning" title={fixMessage} />
          ) : (
            <StatusBanner tone="success" title={`Location ready (about ${Math.round(d.fix.accuracyM)} m accuracy).`} />
          )
        ) : null}
      </Section>

      <Section title="Before you send">
        <TextField label="Note for the reviewer (optional)" value={d.note} onChangeText={(v) => set('note', v)} autoCapitalize="sentences" multiline maxLength={300}
          hint="No links, emails or phone numbers." />
        <Chip label={ATTESTATION_TEXT} selected={d.attestedPublic} onPress={() => set('attestedPublic', !d.attestedPublic)} />
      </Section>

      {errors.length === 1 ? (
        <StatusBanner tone="danger" urgent title={errors[0]!} />
      ) : errors.length > 1 ? (
        <StatusBanner tone="danger" urgent title="Please check these before sending">
          {errors.map((e) => (
            <Text key={e} style={styles.error}>{e}</Text>
          ))}
        </StatusBanner>
      ) : null}
      <PrimaryButton label={busy ? 'Sending…' : isEdit ? 'Send suggestion' : 'Add restroom at my current location'} disabled={busy || locating} onPress={() => void submit()} />
    </View>
  );
}

export default function ContributeScreen() {
  const p = useLocalSearchParams<{ id?: string; name?: string }>();
  const editId = typeof p.id === 'string' && /^[0-9a-f-]{36}$/i.test(p.id) ? p.id : null;
  const editName = typeof p.name === 'string' ? p.name.slice(0, 120) : null;
  return (
    <Screen title={editId ? 'Suggest a correction' : 'Add restroom at my current location'} form>
      <RequireAuth reason="Sign in to add or correct restrooms. This helps us keep the map trustworthy." next={editId ? `/contribute?id=${editId}` : '/contribute'}>
        <Form key={editId ?? 'new'} editId={editId} editName={editName} />
      </RequireAuth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  tri: { gap: spacing.xs },
  label: { ...typography.label, color: colors.text },
  body: { ...typography.body, color: colors.text },
  error: { ...typography.body, color: colors.status.danger.fg },
});
