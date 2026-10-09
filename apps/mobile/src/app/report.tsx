import { REPORT_ISSUES, uncertainWriteMessage, validateReport, type ReportIssue } from '@open-stall/domain';
import { colors, spacing, typography } from '@open-stall/ui';
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { submitReport } from '../account/api';
import { useAuth } from '../auth/AuthProvider';
import { RequireAuth } from '../auth/RequireAuth';
import { RadioGroup } from '../components/RadioGroup';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { StatusBanner } from '../components/StatusBanner';
import { TextField } from '../components/TextField';

function Form({ id, name }: { id: string; name: string | null }) {
  const { rpc } = useAuth();
  const [issue, setIssue] = useState<ReportIssue | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const sending = useRef(false); // synchronous lock: a fast double tap must not send two reports

  if (done) return <StatusBanner tone="success" title="Thanks. A person will take a look." message="Reports are reviewed by a person before anything changes." />;

  const send = async () => {
    const bad = validateReport(issue, comment);
    if (bad) return setError(bad);
    if (!rpc || !issue || sending.current) return;
    sending.current = true;
    setError(null);
    setUncertain(false);
    setBusy(true);
    try {
      const r = await submitReport(rpc, id, issue, comment);
      if (r.ok) setDone(true);
      else if (r.uncertain) {
        setUncertain(true);
        setError(uncertainWriteMessage('your report was sent'));
      } else setError(r.message);
    } catch {
      setUncertain(true);
      setError(uncertainWriteMessage('your report was sent'));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <View style={styles.stack}>
      <Text style={styles.body}>What’s wrong with {name ?? 'this restroom'}?</Text>
      <Text style={styles.hint}>
        “Closed or gone” means permanently closed or removed. For a temporary closure or an out-of-order restroom, choose “Something else” and say so in your note.
      </Text>
      <RadioGroup label="What’s wrong" options={REPORT_ISSUES.map((i) => ({ value: i.key, label: i.label }))} value={issue} onChange={setIssue} />
      <TextField label="Add a note (optional)" value={comment} onChangeText={setComment} autoCapitalize="sentences" multiline maxLength={300}
        hint="No links, emails or phone numbers." />
      {error ? (
        uncertain ? <StatusBanner tone="warning" urgent title="Not confirmed" message={error} /> : <StatusBanner tone="danger" urgent title={error} />
      ) : null}
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
        <StatusBanner tone="danger" urgent title="This restroom link isn’t valid." message="Open the restroom first, then choose Report a problem." />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  body: { ...typography.body, color: colors.text },
  hint: { ...typography.body, color: colors.textMuted },
});
