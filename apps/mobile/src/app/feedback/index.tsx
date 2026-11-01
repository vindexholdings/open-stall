import {
  EMPTY_FEEDBACK, FEEDBACK_FREQUENCIES, FEEDBACK_IMPACTS, FEEDBACK_KINDS, FEEDBACK_LIMITS, FEEDBACK_PRIVACY_NOTE, FEEDBACK_SCREENS, diagnosticsLines, feedbackDiagnostics, newFeedbackKey,
  validateFeedbackDraft, type FeedbackDraft, type FeedbackFieldError,
} from '@open-stall/domain';
import { colors, spacing, typography } from '@open-stall/ui';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { RequireAuth } from '../../auth/RequireAuth';
import { PrimaryButton } from '../../components/PrimaryButton';
import { RadioGroup } from '../../components/RadioGroup';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { SecondaryButton } from '../../components/SecondaryButton';
import { StatusBanner } from '../../components/StatusBanner';
import { TextField } from '../../components/TextField';
import { submitFeedback } from '../../feedback/api';

const diagnostics = feedbackDiagnostics(Platform.OS, Constants.expoConfig?.version);

function Form() {
  const { rpc } = useAuth();
  const router = useRouter();
  const sending = useRef(false); // synchronous lock: a double tap must never send two items
  const [d, setD] = useState<FeedbackDraft>(EMPTY_FEEDBACK);
  const [errors, setErrors] = useState<FeedbackFieldError[]>([]);
  const [failure, setFailure] = useState<{ message: string; uncertain: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const keyRef = useRef<string | null>(null); // the retry key of THIS content: an exact retry reuses it; any edit starts a new one
  const set = <K extends keyof FeedbackDraft>(k: K, v: FeedbackDraft[K]) => { setD((x) => ({ ...x, [k]: v })); keyRef.current = null; setErrors((e) => e.filter((x) => x.field !== k)); };
  const err = (f: keyof FeedbackDraft) => errors.find((e) => e.field === f)?.message ?? null;

  if (done) {
    return (
      <View style={styles.stack}>
        <StatusBanner tone="success" title="Thank you. We received your feedback." message="A person reads every one. You can follow what happens to it under My feedback." />
        <PrimaryButton label="See my feedback" onPress={() => router.replace('/feedback/mine')} />
        <SecondaryButton label="Send something else" onPress={() => { setD(EMPTY_FEEDBACK); keyRef.current = null; setDone(false); }} />
      </View>
    );
  }

  const send = async () => {
    if (sending.current || !rpc) return;
    const problems = validateFeedbackDraft(d);
    setErrors(problems);
    setFailure(null);
    if (problems.length > 0) return;
    sending.current = true;
    setBusy(true);
    try {
      keyRef.current ??= newFeedbackKey(Array.from(await Crypto.getRandomBytesAsync(20), (b) => b.toString(16).padStart(2, '0')).join(''));
      const r = await submitFeedback(rpc, d, diagnostics, keyRef.current);
      if (r.ok) setDone(true);
      else setFailure({ message: r.uncertain ? 'We couldn’t confirm that your feedback was sent. It is safe to try again: it will not be sent twice.' : r.message, uncertain: r.uncertain });
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <View style={styles.stack}>
      {failure ? <StatusBanner tone={failure.uncertain ? 'warning' : 'danger'} urgent title={failure.message} /> : null}
      {errors.length > 0 ? <StatusBanner tone="danger" urgent title="Please fix the highlighted details." /> : null}
      <Section title="What kind of feedback is this?" hint="This is about the app itself. To report a problem with a restroom, use Report a problem on that restroom.">
        <RadioGroup label="Kind of feedback" options={FEEDBACK_KINDS.map((k) => ({ value: k.value, label: k.label }))} value={d.kind} onChange={(v) => set('kind', v)} />
        {err('kind') ? <Text accessibilityRole="alert" style={styles.error}>{err('kind')}</Text> : null}
        <Text style={styles.label}>Where in the app?</Text>
        <RadioGroup label="Where in the app" options={FEEDBACK_SCREENS.map((s) => ({ value: s.value, label: s.label }))} value={d.screen} onChange={(v) => set('screen', v)} />
        {err('screen') ? <Text accessibilityRole="alert" style={styles.error}>{err('screen')}</Text> : null}
      </Section>
      <Section title="Tell us about it" hint={FEEDBACK_PRIVACY_NOTE}>
        <TextField label="Short title" value={d.title} onChangeText={(v) => set('title', v)} maxLength={FEEDBACK_LIMITS.title.max} error={err('title')} autoCapitalize="sentences" />
        <TextField label="What happened or what is your idea?" value={d.description} onChangeText={(v) => set('description', v)} multiline maxLength={FEEDBACK_LIMITS.description.max} error={err('description')} autoCapitalize="sentences" />
        {d.kind !== 'suggestion' ? (
          <>
            <TextField label="What did you expect? (optional)" value={d.expected} onChangeText={(v) => set('expected', v)} multiline maxLength={FEEDBACK_LIMITS.expected} error={err('expected')} autoCapitalize="sentences" />
            <TextField label="What happened instead? (optional)" value={d.actual} onChangeText={(v) => set('actual', v)} multiline maxLength={FEEDBACK_LIMITS.actual} error={err('actual')} autoCapitalize="sentences" />
            <TextField label="Steps to see it again (optional)" value={d.steps} onChangeText={(v) => set('steps', v)} multiline maxLength={FEEDBACK_LIMITS.steps} error={err('steps')} autoCapitalize="sentences" />
            <Text style={styles.label}>How often does it happen? (optional)</Text>
            <RadioGroup label="How often" options={FEEDBACK_FREQUENCIES.map((f) => ({ value: f.value, label: f.label }))} value={d.frequency} onChange={(v) => set('frequency', v)} />
            <Text style={styles.label}>How much does it get in your way? (optional)</Text>
            <RadioGroup label="How much it gets in your way" options={FEEDBACK_IMPACTS.map((f) => ({ value: f.value, label: f.label }))} value={d.impact} onChange={(v) => set('impact', v)} />
          </>
        ) : null}
      </Section>
      <Section title="What we send with it" hint="Only these two technical details. No location, no device identifier, no account details beyond your sign-in, and no attachments.">
        {diagnosticsLines(diagnostics).map((l) => (<Text key={l} style={styles.body}>{l}</Text>))}
      </Section>
      <PrimaryButton label={busy ? 'Sending…' : 'Send feedback'} disabled={busy} onPress={() => void send()} />
    </View>
  );
}

export default function FeedbackScreen() {
  const router = useRouter();
  return (
    <Screen back="pushed" moveFocus title="Send app feedback" form>
      <RequireAuth reason="Sign in to send feedback, so we can show you what happens to it. Finding restrooms never needs an account." next="/feedback">
        <Form />
      </RequireAuth>
      <SecondaryButton label="My feedback" onPress={() => router.push('/feedback/mine')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  label: { ...typography.label, color: colors.text },
  body: { ...typography.body, color: colors.text },
  error: { ...typography.label, color: colors.status.danger.fg },
});
