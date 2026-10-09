import { TRANSPORT_MODES, validateDisplayName, type DisplayMode, type TransportMode } from '@open-stall/domain';
import { useRef, useState } from 'react';
import { usePreferences } from '../account/preferences';
import { RadioGroup } from '../components/RadioGroup';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { Section } from '../components/Section';
import { StatusBanner } from '../components/StatusBanner';
import { TextField } from '../components/TextField';

const MODES: { key: DisplayMode; label: string; hint: string }[] = [
  { key: 'plain', label: 'Plain', hint: 'Straightforward wording and star ratings.' },
  { key: 'risque', label: 'Risqué', hint: 'Playful wording. The facts stay the same.' },
];
const TRANSPORT_LABEL: Record<TransportMode, string> = { walk: 'Walk', bike: 'Bike', drive: 'Drive' };

export default function SettingsScreen() {
  const { prefs, update, signedIn } = usePreferences();
  const [draft, setName] = useState<string | null>(null);
  const name = draft ?? prefs.displayName ?? '';
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false); // synchronous lock: one save at a time

  const run = async (next: typeof prefs) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setMessage(null);
    try {
      const err = await update(next);
      setMessage(err ? { text: err, error: true } : { text: 'Saved.', error: false });
    } finally {
      inFlight.current = false;
    }
  };

  const saveName = async () => {
    if (inFlight.current) return;
    const trimmed = name.trim();
    const bad = trimmed === '' ? null : validateDisplayName(trimmed);
    setNameError(bad);
    if (bad) return;
    inFlight.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const err = await update({ ...prefs, displayName: trimmed === '' ? null : trimmed });
      if (!err) setName(null);
      setMessage(err ? { text: err, error: true } : { text: 'Saved.', error: false });
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <Screen title="Settings" form>
      {message ? (
        <StatusBanner tone={message.error ? 'danger' : 'success'} urgent={message.error} title={message.text} />
      ) : null}

      <Section title="Display style" hint={MODES.find((m) => m.key === prefs.mode)!.hint}>
        <RadioGroup
          label="Display style"
          options={MODES.map((m) => ({ value: m.key, label: m.label }))}
          value={prefs.mode}
          onChange={(mode) => void run({ ...prefs, mode })}
        />
      </Section>

      <Section title="Usual way of getting around" hint="Used as the starting choice for directions.">
        <RadioGroup
          label="Usual way of getting around"
          options={TRANSPORT_MODES.map((t) => ({ value: t, label: TRANSPORT_LABEL[t] }))}
          value={prefs.transport}
          onChange={(transport) => void run({ ...prefs, transport })}
        />
      </Section>

      {signedIn ? (
        <Section title="Display name">
          <TextField label="Display name (optional)" value={name} onChangeText={(v) => { setName(v); setNameError(null); }} autoCapitalize="words" maxLength={30}
            error={nameError}
            hint="May be shown publicly later (for example on leaderboards). Don’t use your real name or email." />
          <PrimaryButton label={saving ? 'Saving…' : 'Save display name'} disabled={saving} onPress={() => void saveName()} />
        </Section>
      ) : (
        <StatusBanner tone="info" title="Saved on this device" message="Sign in to keep these settings across devices and to set a display name." />
      )}
    </Screen>
  );
}
