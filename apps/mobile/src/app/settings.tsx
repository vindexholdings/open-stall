import { TRANSPORT_MODES, validateDisplayName, type DisplayMode, type TransportMode } from '@open-stall/domain';
import { colors, spacing, typography } from '@open-stall/ui';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { usePreferences } from '../account/preferences';
import { Chip } from '../components/Chip';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
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
  const [saving, setSaving] = useState(false);

  const run = async (next: typeof prefs) => {
    setMessage(null);
    const err = await update(next);
    if (err) setMessage({ text: err, error: true });
  };

  const saveName = async () => {
    const trimmed = name.trim();
    const bad = trimmed === '' ? null : validateDisplayName(trimmed);
    if (bad) return setMessage({ text: bad, error: true });
    setSaving(true);
    setMessage(null);
    const err = await update({ ...prefs, displayName: trimmed === '' ? null : trimmed });
    setSaving(false);
    if (!err) setName(null);
    setMessage(err ? { text: err, error: true } : { text: 'Saved.', error: false });
  };

  return (
    <Screen title="Settings">
      <View style={styles.group}>
        <Text accessibilityRole="header" style={styles.heading}>Display style</Text>
        <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Display style">
          {MODES.map((m) => (
            <Chip key={m.key} role="radio" label={m.label} selected={prefs.mode === m.key} onPress={() => void run({ ...prefs, mode: m.key })} />
          ))}
        </View>
        <Text style={styles.hint}>{MODES.find((m) => m.key === prefs.mode)!.hint}</Text>
      </View>

      <View style={styles.group}>
        <Text accessibilityRole="header" style={styles.heading}>Usual way of getting around</Text>
        <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Usual way of getting around">
          {TRANSPORT_MODES.map((t) => (
            <Chip key={t} role="radio" label={TRANSPORT_LABEL[t]} selected={prefs.transport === t} onPress={() => void run({ ...prefs, transport: t })} />
          ))}
        </View>
        <Text style={styles.hint}>Used as the starting choice for directions.</Text>
      </View>

      {signedIn ? (
        <View style={styles.group}>
          <Text accessibilityRole="header" style={styles.heading}>Display name</Text>
          <TextField label="Display name (optional)" value={name} onChangeText={setName} autoCapitalize="words" maxLength={30}
            hint="May be shown publicly later (for example on leaderboards). Don’t use your real name or email." />
          <PrimaryButton label={saving ? 'Saving…' : 'Save display name'} disabled={saving} onPress={() => void saveName()} />
        </View>
      ) : (
        <Text style={styles.hint}>These settings are saved on this device. Sign in to keep them across devices and set a display name.</Text>
      )}
      {message ? <Text style={message.error ? styles.error : styles.ok} accessibilityRole={message.error ? 'alert' : undefined} accessibilityLiveRegion="polite">{message.text}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  heading: { ...typography.heading, color: colors.text },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  hint: { ...typography.label, fontWeight: '400', color: colors.textMuted },
  error: { ...typography.body, color: colors.status.danger.fg },
  ok: { ...typography.body, color: colors.text },
});
