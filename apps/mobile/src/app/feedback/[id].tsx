import { FEEDBACK_FREQUENCIES, FEEDBACK_IMPACTS, FEEDBACK_KINDS, FEEDBACK_SCREENS, FEEDBACK_STATUS_LABEL, type FeedbackDetail } from '@open-stall/domain';
import { colors, spacing, typography } from '@open-stall/ui';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { RequireAuth } from '../../auth/RequireAuth';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { SecondaryButton } from '../../components/SecondaryButton';
import { StatusBanner } from '../../components/StatusBanner';
import { getMyFeedback } from '../../feedback/api';
import { OwnerScope } from '../../feedback/OwnerScope';

function Field({ label, value }: { label: string; value: string | null }) {
  return value ? (<View style={styles.field}><Text style={styles.label}>{label}</Text><Text style={styles.body}>{value}</Text></View>) : null;
}

function Detail({ id }: { id: string }) {
  const { rpc, userId } = useAuth();
  const [item, setItem] = useState<FeedbackDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ticket = useRef(0);
  const invalidate = useCallback(() => { ticket.current++; }, []);
  const apply = useCallback((mine: number, r: Awaited<ReturnType<typeof getMyFeedback>>) => {
    if (mine !== ticket.current) return;
    if (r.ok) { setItem(r.item); setError(null); } else { setItem(null); setError(r.message); }
  }, []);
  const retry = useCallback(() => {
    if (!rpc) return;
    const mine = ++ticket.current;
    setError(null);
    void getMyFeedback(rpc, id).then((r) => apply(mine, r));
  }, [rpc, id, apply]);
  useEffect(() => {
    if (!rpc) return;
    const mine = ++ticket.current;
    void getMyFeedback(rpc, id).then((r) => apply(mine, r));
    return invalidate;
  }, [rpc, id, userId, apply, invalidate]);

  if (error) return (<StatusBanner tone="warning" urgent title={error}><SecondaryButton label="Try again" onPress={retry} /></StatusBanner>);
  if (!item) return <StatusBanner tone="info" title="Loading…" />;
  const kind = FEEDBACK_KINDS.find((k) => k.value === item.kind)?.label ?? item.kind;
  const screen = FEEDBACK_SCREENS.find((k) => k.value === item.screen)?.label ?? item.screen;
  return (
    <View style={styles.stack}>
      <StatusBanner tone={item.status === 'resolved' ? 'success' : 'info'} title={`${FEEDBACK_STATUS_LABEL[item.status]}`} message={item.outcome} />
      <Section title={item.title} hint={`${kind} · ${screen} · sent ${item.createdAt.slice(0, 10)}`}>
        <Field label="What you told us" value={item.description} />
        <Field label="What you expected" value={item.expected} />
        <Field label="What happened instead" value={item.actual} />
        <Field label="Steps" value={item.steps} />
        <Field label="How often" value={FEEDBACK_FREQUENCIES.find((f) => f.value === item.frequency)?.label ?? null} />
        <Field label="How much it got in your way" value={FEEDBACK_IMPACTS.find((f) => f.value === item.impact)?.label ?? null} />
        <Field label="App version" value={item.appVersion} />
      </Section>
      <Section title="What happened to it">
        {item.timeline.map((t, i) => (<Text key={`${t.status}-${i}`} style={styles.body}>{t.at.slice(0, 10)}: {FEEDBACK_STATUS_LABEL[t.status]}</Text>))}
      </Section>
    </View>
  );
}

export default function FeedbackDetailScreen() {
  const p = useLocalSearchParams<{ id?: string }>();
  const id = typeof p.id === 'string' && /^[0-9a-f-]{36}$/i.test(p.id) ? p.id : null;
  return (
    <Screen back="pushed" moveFocus title="Your feedback" form>
      {id ? (
        <RequireAuth reason="Sign in to see your feedback." next={`/feedback/${id}`}><OwnerScope scope={id}><Detail id={id} /></OwnerScope></RequireAuth>
      ) : (
        <StatusBanner tone="warning" title="We couldn’t find that feedback." />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  field: { gap: 2 },
  label: { ...typography.label, color: colors.textMuted },
  body: { ...typography.body, color: colors.text },
});
