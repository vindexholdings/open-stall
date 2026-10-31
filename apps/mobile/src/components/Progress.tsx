import {
  COMING_SOON_TEXT, SIGNED_OUT_TEXT, UNAVAILABLE_TEXT, howToEarn, itemName, numericTarget, progressSentence, stateText, type ProgressItem,
} from '@open-stall/domain';
import { colors, radii, spacing, tiles, touchTarget, typography } from '@open-stall/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ProgressView } from '../rewards/view';
import { Icon } from './Icon';
import { enterActivates, useFocusStyle } from './focus';

/** Text hidden from assistive technology (it is spoken once, by the element that owns it). */
const HIDDEN = { 'aria-hidden': true, importantForAccessibility: 'no-hide-descendants' } as const;

function ActionButton({ label, hint, onPress, role = 'button' }: { label: string; hint?: string; onPress: () => void; role?: 'button' | 'link' }) {
  const focus = useFocusStyle();
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityHint={hint}
      onPress={onPress}
      {...(role === 'link' ? enterActivates(onPress) : {})}
      {...focus.handlers}
      style={({ pressed }) => [styles.action, pressed && styles.dim, focus.style]}
    >
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

/**
 * ONE accessible progress element per numeric target. Its accessible name is the badge name and its value text is the full sentence
 * ("3 of 5 different places in October 2026, 2 to go"). The visible name and sentence are the SAME strings, drawn as text and hidden
 * from assistive technology so nothing is spoken twice; the bar is part of the same element. Meaning never relies on color alone
 * (the sentence is always visible), the element is at least 48 px tall, and nothing animates.
 */
function ProgressBar({ item }: { item: ProgressItem }) {
  const t = numericTarget(item);
  const sentence = progressSentence(item);
  if (!t || !sentence) return null;
  const name = itemName(item);
  const pct = Math.min(100, Math.round((Math.min(t.now, t.max) / t.max) * 100));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={name}
      aria-valuemin={0}
      aria-valuemax={t.max}
      aria-valuenow={Math.min(t.now, t.max)}
      aria-valuetext={sentence}
      style={styles.barBox}
    >
      <Text {...HIDDEN} style={styles.name}>{name}</Text>
      <Text {...HIDDEN} style={styles.sentence}>{sentence}</Text>
      <View {...HIDDEN} style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

/** One badge/challenge: name, a plain state line (never color-only) and how to earn it. */
export function ProgressItemView({ item }: { item: ProgressItem }) {
  const line = stateText(item);
  const bar = item.state === 'in_progress' || item.state === 'updating' || item.state === 'earned' ? <ProgressBar item={item} /> : null;
  const earn = item.state === 'in_progress' || item.state === 'updating' ? howToEarn(item) : null;
  return (
    <View style={styles.item}>
      {bar ?? <Text style={styles.name}>{itemName(item)}</Text>}
      {line ? <Text style={[styles.state, item.state === 'earned' && styles.stateEarned]}>{line}</Text> : null}
      {earn ? <Text style={styles.how}>{earn}</Text> : null}
    </View>
  );
}

/** The polite live region: a newly earned badge is announced once, then stays visible as text. */
function Announce({ text }: { text: string | null }) {
  return (
    <View accessibilityLiveRegion="polite" aria-live="polite" role="status">
      {text ? <Text style={styles.announce}>{text}</Text> : null}
    </View>
  );
}

/** Dashboard card: compact. Production-disabled builds show only the honest preview, with no number. */
export function ProgressCard({ view, onSignIn, onOpenList, onRetry }: { view: ProgressView; onSignIn: () => void; onOpenList: () => void; onRetry: () => void }) {
  const shown = view.kind === 'ready' ? view.items.slice(0, 2) : [];
  return (
    <View role="region" aria-label="VIP progress" style={styles.card}>
      <View style={styles.head}>
        <View style={styles.icon}><Icon name="medal" size={20} color={tiles.amber.fg} inner={tiles.amber.bg} /></View>
        <View style={styles.headText}>
          <Text style={styles.title}>{view.kind === 'coming_soon' ? COMING_SOON_TEXT : 'VIP progress'}</Text>
          {view.kind === 'coming_soon' ? <Text style={styles.sub}>Challenges — not available yet</Text> : null}
          {view.kind === 'signed_out' ? <Text style={styles.sub}>{SIGNED_OUT_TEXT}</Text> : null}
          {view.kind === 'loading' ? <Text style={styles.sub} role="status">Loading your progress…</Text> : null}
          {view.kind === 'error' ? <Text style={styles.sub} role="alert">{UNAVAILABLE_TEXT}</Text> : null}
          {view.kind === 'ready' && shown.length === 0 ? <Text style={styles.sub}>No badges to show yet.</Text> : null}
        </View>
      </View>
      {view.kind === 'ready' ? <Announce text={view.announcement} /> : null}
      {shown.map((i) => (<ProgressItemView key={`${i.achievement}|${i.period}`} item={i} />))}
      {view.kind === 'signed_out' ? <ActionButton label="Sign in" role="link" hint="Opens sign in." onPress={onSignIn} /> : null}
      {view.kind === 'error' ? <ActionButton label="Try again" onPress={onRetry} /> : null}
      {view.kind === 'ready' ? <ActionButton label="See all progress" role="link" hint="Opens your progress in your account." onPress={onOpenList} /> : null}
    </View>
  );
}

/** The full list in the account area: cursor paging ("Show more"), retry, and the same honest states. */
export function ProgressList({ view, onMore, onRetry }: { view: ProgressView; onMore: () => void; onRetry: () => void }) {
  if (view.kind === 'coming_soon') return <Text style={styles.sub}>{COMING_SOON_TEXT}. Nothing to show yet.</Text>;
  if (view.kind === 'signed_out') return <Text style={styles.sub}>{SIGNED_OUT_TEXT}</Text>;
  if (view.kind === 'loading') return <Text style={styles.sub} role="status">Loading your progress…</Text>;
  if (view.kind === 'error') return (
    <View style={styles.stack}>
      <Text style={styles.sub} role="alert">{UNAVAILABLE_TEXT}</Text>
      <ActionButton label="Try again" onPress={onRetry} />
    </View>
  );
  return (
    <View style={styles.stack}>
      <Announce text={view.announcement} />
      {view.items.length === 0 ? <Text style={styles.sub}>No badges to show yet.</Text> : null}
      {view.items.map((i) => (<ProgressItemView key={`${i.achievement}|${i.period}`} item={i} />))}
      {view.moreError ? <Text style={styles.sub} role="alert">Could not load more. {UNAVAILABLE_TEXT}</Text> : null}
      {view.nextCursor ? <ActionButton label={view.loadingMore ? 'Loading…' : view.moreError ? 'Try again' : 'Show more'} onPress={onMore} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { opacity: 0.85 },
  stack: { gap: spacing.sm },
  card: { gap: spacing.sm, padding: spacing.sm + 2, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: tiles.amber.bg, alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1, minWidth: 0 },
  title: { ...typography.label, fontSize: 15, color: colors.text },
  sub: { ...typography.label, fontWeight: '400', color: colors.textMuted },
  item: { gap: spacing.xs, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  name: { ...typography.label, fontSize: 15, color: colors.text },
  state: { ...typography.label, fontWeight: '400', color: colors.text },
  stateEarned: { fontWeight: '700' },
  how: { ...typography.label, fontWeight: '400', color: colors.textMuted },
  barBox: { minHeight: touchTarget.min, justifyContent: 'center', gap: spacing.xs },
  sentence: { ...typography.label, fontWeight: '400', color: colors.text },
  track: { height: 10, borderRadius: 5, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.textMuted, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.primaryStrong },
  announce: { ...typography.label, color: colors.text, fontWeight: '700' },
  action: { minHeight: touchTarget.min, justifyContent: 'center', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: spacing.md, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.primaryStrong, backgroundColor: colors.surface },
  actionText: { ...typography.label, fontSize: 15, color: colors.primaryStrong },
});
