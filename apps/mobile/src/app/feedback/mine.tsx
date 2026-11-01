import { FEEDBACK_KINDS, FEEDBACK_SCREENS, FEEDBACK_STATUS_LABEL, type FeedbackListItem } from '@open-stall/domain';
import { colors, spacing, typography } from '@open-stall/ui';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { RequireAuth } from '../../auth/RequireAuth';
import { enterActivates, useFocusStyle } from '../../components/focus';
import { PrimaryButton } from '../../components/PrimaryButton';
import { Screen } from '../../components/Screen';
import { SecondaryButton } from '../../components/SecondaryButton';
import { StatusBanner } from '../../components/StatusBanner';
import { listMyFeedback } from '../../feedback/api';
import { OwnerScope } from '../../feedback/OwnerScope';

const kindLabel = (k: string) => FEEDBACK_KINDS.find((x) => x.value === k)?.label ?? k;
const screenLabel = (s: string) => FEEDBACK_SCREENS.find((x) => x.value === s)?.label ?? s;
const day = (iso: string) => iso.slice(0, 10);

function Row({ item, onOpen }: { item: FeedbackListItem; onOpen: (id: string) => void }) {
  const focus = useFocusStyle();
  const open = () => onOpen(item.id);
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`${item.title}. ${FEEDBACK_STATUS_LABEL[item.status]}.`} onPress={open} {...enterActivates(open)} {...focus.handlers} style={[styles.row, focus.style]}>
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.meta}>{kindLabel(item.kind)} · {screenLabel(item.screen)} · sent {day(item.createdAt)}</Text>
      <Text style={styles.status}>{FEEDBACK_STATUS_LABEL[item.status]}: {item.outcome}</Text>
    </Pressable>
  );
}

function List() {
  const { rpc, userId } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<FeedbackListItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const ticket = useRef(0);
  const invalidate = useCallback(() => { ticket.current++; }, []);

  /** Applies one page answer, unless the account or the request is stale (a newer request, sign-out or another account owns the screen). */
  const apply = useCallback((mine: number, cursor: string | null, r: Awaited<ReturnType<typeof listMyFeedback>>) => {
    if (mine !== ticket.current) return;
    setLoadingMore(false);
    if (!r.ok) { setError(r.message); if (cursor === null) setItems(null); return; }
    setError(null);
    setItems((prev) => (cursor === null || !prev ? r.items : [...prev, ...r.items.filter((i) => !prev.some((p) => p.id === i.id))]));
    setNext(r.nextCursor);
  }, []);
  const load = useCallback((cursor: string | null) => {
    if (!rpc) return;
    const mine = ++ticket.current;
    void listMyFeedback(rpc, cursor).then((r) => apply(mine, cursor, r));
  }, [rpc, apply]);

  useEffect(() => {
    if (!rpc) return;
    const mine = ++ticket.current;
    void listMyFeedback(rpc, null).then((r) => apply(mine, null, r));
    return invalidate;
  }, [rpc, userId, apply, invalidate]);

  if (error && items === null) {
    return (
      <StatusBanner tone="warning" urgent title={error}>
        <SecondaryButton label="Try again" onPress={() => load(null)} />
      </StatusBanner>
    );
  }
  if (items === null) return <StatusBanner tone="info" title="Loading your feedback…" />;
  if (items.length === 0) {
    return (
      <StatusBanner tone="info" title="You haven’t sent any feedback yet." message="Found a bug or have an idea? Tell us.">
        <PrimaryButton label="Send feedback" onPress={() => router.push('/feedback')} />
      </StatusBanner>
    );
  }
  return (
    <View style={styles.stack}>
      {items.map((i) => (<Row key={i.id} item={i} onOpen={(id) => router.push({ pathname: '/feedback/[id]', params: { id } })} />))}
      {error ? <StatusBanner tone="warning" urgent title={error} /> : null}
      {next ? <SecondaryButton label={loadingMore ? 'Loading…' : 'Show more'} disabled={loadingMore} onPress={() => { setLoadingMore(true); load(next); }} /> : null}
    </View>
  );
}

export default function MyFeedbackScreen() {
  return (
    <Screen back="pushed" moveFocus title="My feedback" form>
      <RequireAuth reason="Sign in to see the feedback you sent." next="/feedback/mine">
        <OwnerScope><List /></OwnerScope>
      </RequireAuth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  row: { gap: 2, padding: spacing.md, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, minHeight: 48 },
  title: { ...typography.heading, color: colors.text },
  meta: { ...typography.label, fontWeight: '400', color: colors.textMuted },
  status: { ...typography.body, color: colors.text },
});
