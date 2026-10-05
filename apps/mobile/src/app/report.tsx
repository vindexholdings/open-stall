import { REPORT_ISSUES, validateReport, type ReportIssue } from '@open-stall/domain';
import { colors, spacing, typography } from '@open-stall/ui';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { submitReport } from '../account/api';
import { useAuth } from '../auth/AuthProvider';
import { RequireAuth } from '../auth/RequireAuth';
import { Chip } from '../components/Chip';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';

function Form({ id, name }: { id: string; name: string | null }) {
  const { rpc } = useAuth();
  const [issue, setIssue] = useState<ReportIssue | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (done) return <Text style={styles.body} accessibilityLiveRegion="polite">Thanks. A person will take a look.</Text>;

  const send = async () => {
    const bad = validateReport(issue, comment);
    if (bad) return setError(bad);
    if (!rpc || !issue) return;
    setError(null);
    setBusy(true);
    const r = await submitReport(rpc, id, issue, comment);
    setBusy(false);
    if (r.ok) setDone(true);
    else setError(r.message);
  };

  return (
    <View style={styles.stack}>
      <Text style={styles.body}>What’s wrong with {name ?? 'this restroom'}?</Text>
      <View style={styles.stack} accessibilityRole="radiogroup" accessibilityLabel="What’s wrong">
        {REPORT_ISSUES.map((i) => (
          <Chip key={i.key} role="radio" label={i.label} selected={issue === i.key} onPress={() => setIssue(i.key)} />
        ))}
      </View>
      <TextField label="Add a note (optional)" value={comment} onChangeText={setComment} autoCapitalize="sentences" multiline maxLength={300}
        hint="No links, emails or phone numbers." />
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <PrimaryButton label={busy ? 'Sending…' : 'Send report'} disabled={busy} onPress={() => void send()} />
    </View>
  );
}

export default function ReportScreen() {
  const p = useLocalSearchParams<{ id?: string; name?: string }>();
  const id = typeof p.id === 'string' && /^[0-9a-f-]{36}$/i.test(p.id) ? p.id : null;
  const name = typeof p.name === 'string' ? p.name.slice(0, 120) : null;
  return (
    <Screen title="Report a problem">
      {id ? (
        <RequireAuth reason="Sign in to report a problem. Reports help keep information accurate and safe." next={`/report?id=${id}`}>
          <Form key={id} id={id} name={name} />
        </RequireAuth>
      ) : (
        <Text style={styles.body}>This restroom link isn’t valid.</Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  body: { ...typography.body, color: colors.text },
  error: { ...typography.body, color: colors.status.danger.fg },
});
