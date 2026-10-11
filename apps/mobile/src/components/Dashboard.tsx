import type { VerificationBadge as Badge } from '@open-stall/domain';
import { colors, radii, shadows, spacing, tiles, touchTarget, typography, type TileTone } from '@open-stall/ui';
import type { Ref } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon, type IconName } from './Icon';
import { VerificationBadge } from './VerificationBadge';
import { enterActivates, useFocusStyle } from './focus';

/* ------------------------------------------------------------------ nearest restroom: compact featured card */

export type NearestRestroom = {
  id: string;
  name: string;
  /** "0.35 mi", with a note that it is a straight-line distance (not a route), so it is never mistaken for walking time. */
  distance: string;
  distanceNote: string;
  badge: Badge;
  /** Known facts only (never an unknown shown as a negative). */
  facts: string[];
  subtitle?: string;
};

function HeroButton({ label, accessibilityLabel, accessibilityHint, icon, primary, onPress, role = 'button' }: {
  label: string; accessibilityLabel: string; accessibilityHint?: string; icon: IconName; primary: boolean; onPress: () => void; role?: 'button' | 'link';
}) {
  const focus = useFocusStyle();
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      {...(role === 'link' ? enterActivates(onPress) : {})}
      {...focus.handlers}
      style={({ pressed }) => [styles.heroBtn, primary ? styles.heroBtnPrimary : styles.heroBtnGhost, pressed && styles.dim, focus.style && { ...focus.style, outlineColor: colors.onHero }]}
    >
      <Icon name={icon} size={18} color={primary ? colors.primaryStrong : colors.onHero} inner={primary ? colors.onHero : colors.hero} />
      <Text style={[styles.heroBtnText, { color: primary ? colors.primaryStrong : colors.onHero }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * The nearest restroom, compact: name beside a large distance, then status and known facts on one wrapping line, then the
 * two real actions side by side. Nothing has a fixed height, so larger text simply makes the card taller.
 * `narrowed`: a search or filter is active, so this is the nearest MATCH and the card says so.
 */
export function NearestCard({ item, onDirections, onOpen, narrowed = false }: { item: NearestRestroom; onDirections: () => void; onOpen: (id: string) => void; narrowed?: boolean }) {
  const kicker = narrowed ? 'Nearest match' : 'Nearest restroom';
  return (
    <View role="region" aria-label={kicker} style={styles.hero}>
      <View style={styles.heroHead}>
        <View style={styles.heroTitleBlock}>
          <Text style={styles.heroKicker}>{kicker}</Text>
          <Text accessibilityRole="header" aria-level={2} style={styles.heroName}>{item.name}</Text>
        </View>
        <View style={styles.heroDistanceBlock}>
          <Text style={styles.heroDistance}>{item.distance}</Text>
          <Text style={styles.heroTravel}>{item.distanceNote}</Text>
        </View>
      </View>
      <View style={styles.heroMeta}>
        <VerificationBadge badge={item.badge} />
        {item.facts.length > 0 ? <Text style={styles.heroFacts}>{item.facts.join(' · ')}</Text> : null}
      </View>
      <View style={styles.heroActions}>
        <HeroButton
          primary
          icon="navigate"
          label="Directions"
          accessibilityLabel={`Directions to ${item.name}`}
          accessibilityHint="Opens a maps app with directions to this restroom."
          onPress={onDirections}
        />
        <HeroButton
          primary={false}
          icon="chevron"
          label="Details"
          role="link"
          accessibilityLabel={`Details for ${item.name}`}
          accessibilityHint="Opens restroom details."
          onPress={() => onOpen(item.id)}
        />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ compact actions */

export type QuickAction = {
  key: string;
  /** Short visible label (also part of the spoken name). */
  label: string;
  /** Longer spoken name; it must contain the visible label. */
  spoken: string;
  icon: IconName;
  tone: TileTone;
  onPress: () => void;
  /** Routes to another screen (a link) versus changing this screen (a button). */
  kind: 'link' | 'button';
};

function Pill({ action }: { action: QuickAction }) {
  const focus = useFocusStyle();
  const tone = tiles[action.tone];
  return (
    <Pressable
      accessibilityRole={action.kind}
      accessibilityLabel={action.spoken}
      onPress={action.onPress}
      {...(action.kind === 'link' ? enterActivates(action.onPress) : {})}
      {...focus.handlers}
      style={({ pressed }) => [styles.pill, pressed && styles.dim, focus.style]}
    >
      <View style={[styles.pillIcon, { backgroundColor: tone.bg }]}><Icon name={action.icon} size={18} color={tone.fg} inner={tone.bg} /></View>
      <Text style={styles.pillLabel}>{action.label}</Text>
    </Pressable>
  );
}

/** Shortcuts into features that already exist; each keeps its own sign-in rules and public discovery stays signed out. */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <View role="group" aria-label="Quick actions" style={styles.pills}>
      {actions.map((a) => (<Pill key={a.key} action={a} />))}
    </View>
  );
}

/* ------------------------------------------------------------------ search + filters row */

/**
 * One row: a labeled search over the restrooms already loaded (local only; it never looks anything up) and the Filters
 * button. The input's accessible name is "Search these restrooms"; the placeholder says what it searches.
 */
export function SearchBar({ value, onChange, activeFilters, onOpenFilters, buttonRef }: {
  value: string; onChange: (next: string) => void; activeFilters: number; onOpenFilters: () => void;
  /** The Filters button, so focus can return to it when the filter sheet closes (native screen readers). */
  buttonRef?: Ref<View>;
}) {
  const inputFocus = useFocusStyle();
  const btnFocus = useFocusStyle();
  const clearFocus = useFocusStyle();
  return (
    <View style={styles.searchRow}>
      <View style={[styles.searchBox, inputFocus.style]}>
        <Icon name="search" size={20} color={colors.textMuted} />
        <TextInput
          accessibilityLabel="Search these restrooms"
          placeholder="Search name, street or town"
          placeholderTextColor={colors.textMuted}
          value={value}
          onChangeText={onChange}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          {...inputFocus.handlers}
          style={styles.searchInput}
        />
        {value.trim() ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => onChange('')} {...clearFocus.handlers} style={[styles.clearBtn, clearFocus.style]}>
            <Icon name="close" size={16} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      <Pressable
        ref={buttonRef}
        accessibilityRole="button"
        aria-haspopup="dialog"
        accessibilityLabel={activeFilters ? `Show filters, ${activeFilters} active` : 'Show filters'}
        accessibilityHint="Opens the filter choices."
        onPress={onOpenFilters}
        {...btnFocus.handlers}
        style={({ pressed }) => [styles.filterBtn, activeFilters > 0 && styles.filterBtnOn, pressed && styles.dim, btnFocus.style]}
      >
        <Icon name="filter" size={20} color={activeFilters > 0 ? colors.onPrimaryStrong : tiles.teal.fg} inner={activeFilters > 0 ? colors.primaryStrong : colors.surface} />
        <Text style={[styles.filterText, activeFilters > 0 && styles.filterTextOn]}>{activeFilters ? `Filters (${activeFilters})` : 'Filters'}</Text>
      </Pressable>
    </View>
  );
}

/* ------------------------------------------------------------------ VIP preview (honest: nothing is earned yet) */

/** A compact, non-interactive preview. There is no rewards ledger yet, so it states that plainly and shows no number. */
export function VipPreview() {
  return (
    <View role="region" aria-label="VIP progress" style={styles.vip}>
      <View style={styles.vipIcon}><Icon name="medal" size={20} color={tiles.amber.fg} inner={tiles.amber.bg} /></View>
      <View style={styles.vipText}>
        <Text style={styles.vipTitle}>VIP progress — rewards coming soon</Text>
        <Text style={styles.vipSub}>Challenges — not available yet</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { opacity: 0.85 },
  hero: { backgroundColor: colors.hero, borderRadius: radii.lg, padding: spacing.md - 2, gap: spacing.sm, ...shadows.hero },
  heroHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  heroTitleBlock: { flex: 1, minWidth: 0, gap: 2 },
  heroKicker: { ...typography.label, fontSize: 12, lineHeight: 16, color: colors.heroMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  heroName: { fontSize: 20, lineHeight: 25, fontWeight: '700', color: colors.onHero },
  heroDistanceBlock: { alignItems: 'flex-end' },
  heroDistance: { fontSize: 26, lineHeight: 30, fontWeight: '800', color: colors.onHero },
  heroTravel: { ...typography.label, fontWeight: '400', color: colors.heroMuted },
  heroMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.sm, rowGap: spacing.xs },
  heroFacts: { ...typography.label, fontWeight: '400', color: colors.onHero, flexShrink: 1 },
  heroActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  heroBtn: { minHeight: touchTarget.min, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radii.pill, flexGrow: 1, flexBasis: 120 },
  heroBtnPrimary: { backgroundColor: colors.onHero },
  heroBtnGhost: { borderWidth: 2, borderColor: colors.onHero },
  heroBtnText: { ...typography.label, fontSize: 16, lineHeight: 20 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2 },
  pill: { minHeight: touchTarget.min, flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, paddingLeft: spacing.xs + 2, paddingRight: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadows.card },
  pillIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  pillLabel: { ...typography.label, fontSize: 15, color: colors.text },
  searchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  searchBox: { flex: 1, flexBasis: 200, minHeight: touchTarget.min, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, minWidth: 0, minHeight: touchTarget.min - 4, color: colors.text, fontSize: typography.body.fontSize, outlineStyle: 'none' as never },
  clearBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  filterBtn: { minHeight: touchTarget.min, flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, paddingHorizontal: spacing.md, borderRadius: radii.pill, backgroundColor: tiles.teal.bg, borderWidth: 1, borderColor: tiles.teal.fg },
  filterBtnOn: { backgroundColor: colors.primaryStrong, borderColor: colors.primaryStrong },
  filterText: { ...typography.label, fontSize: 15, color: tiles.teal.fg },
  filterTextOn: { color: colors.onPrimaryStrong },
  vip: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm + 2, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
  vipIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: tiles.amber.bg, alignItems: 'center', justifyContent: 'center' },
  vipText: { flex: 1, minWidth: 0 },
  vipTitle: { ...typography.label, fontSize: 15, color: colors.text },
  vipSub: { ...typography.label, fontWeight: '400', color: colors.textMuted },
});
