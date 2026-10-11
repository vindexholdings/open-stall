import type { VerificationBadge as Badge } from '@open-stall/domain';
import { colors, radii, shadows, spacing, tiles, touchTarget, typography, type TileTone } from '@open-stall/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from './Icon';
import { TextField } from './TextField';
import { VerificationBadge } from './VerificationBadge';
import { enterActivates, useFocusStyle } from './focus';

/* ------------------------------------------------------------------ nearest restroom hero */

export type NearestRestroom = {
  id: string;
  name: string;
  /** "0.3 mi" and "~4 min walk": the same truthful, distance-first values the list uses. */
  distance: string;
  travel: string;
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
      <Icon name={icon} size={20} color={primary ? colors.primaryStrong : colors.onHero} inner={primary ? colors.onHero : colors.hero} />
      <Text style={[styles.heroBtnText, { color: primary ? colors.primaryStrong : colors.onHero }]}>{label}</Text>
    </Pressable>
  );
}

/** The nearest restroom, big: distance first, honest verification status, known facts, and real next steps. */
/** `narrowed`: a search or filter is active, so this is the nearest MATCH, and the card says so instead of claiming it is the nearest restroom overall. */
export function NearestCard({ item, onDirections, onOpen, narrowed = false }: { item: NearestRestroom; onDirections: () => void; onOpen: (id: string) => void; narrowed?: boolean }) {
  const kicker = narrowed ? 'Nearest match' : 'Nearest restroom';
  return (
    <View role="region" aria-label={kicker} style={styles.hero}>
      <View style={styles.heroTop}>
        <View style={styles.heroIcon}><Icon name="pin" size={22} color={colors.hero} inner={colors.heroAccent} /></View>
        <Text style={styles.heroKicker}>{kicker}</Text>
      </View>
      <Text accessibilityRole="header" aria-level={2} style={styles.heroName}>{item.name}</Text>
      <View style={styles.heroDistanceRow}>
        <Text style={styles.heroDistance}>{item.distance}</Text>
        <Text style={styles.heroTravel}>{item.travel}</Text>
      </View>
      <VerificationBadge badge={item.badge} />
      {item.subtitle ? <Text style={styles.heroSub}>{item.subtitle}</Text> : null}
      {item.facts.length > 0 ? (
        <View style={styles.heroFacts}>
          {item.facts.map((f) => (<Text key={f} style={styles.heroFact}>{f}</Text>))}
        </View>
      ) : null}
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

/* ------------------------------------------------------------------ quick actions */

export type QuickAction = {
  key: string;
  label: string;
  hint: string;
  icon: IconName;
  tone: TileTone;
  onPress: () => void;
  /** Routes to another screen (a link) versus changing this screen (a button). */
  kind: 'link' | 'button';
  /** Expanded state for disclosure actions (Filters). */
  expanded?: boolean;
};

function Tile({ action }: { action: QuickAction }) {
  const focus = useFocusStyle();
  const tone = tiles[action.tone];
  return (
    <Pressable
      accessibilityRole={action.kind}
      accessibilityLabel={`${action.label}. ${action.hint}`}
      aria-expanded={action.expanded}
      onPress={action.onPress}
      {...(action.kind === 'link' ? enterActivates(action.onPress) : {})}
      {...focus.handlers}
      style={({ pressed }) => [styles.tile, pressed && styles.dim, focus.style]}
    >
      <View style={[styles.tileIcon, { backgroundColor: tone.bg }]}><Icon name={action.icon} size={24} color={tone.fg} inner={tone.bg} /></View>
      <View style={styles.tileText}>
        <Text style={styles.tileLabel}>{action.label}</Text>
        <Text style={styles.tileHint}>{action.hint}</Text>
      </View>
    </Pressable>
  );
}

/** Shortcuts into features that already exist; each keeps its own sign-in rules and public discovery stays signed out. */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <View role="group" aria-label="Quick actions" style={styles.tiles}>
      {actions.map((a) => (<View key={a.key} style={styles.tileCell}><Tile action={a} /></View>))}
    </View>
  );
}

/* ------------------------------------------------------------------ search */

/** Labeled search over the restrooms already loaded below. Local only: it never looks anything up. */
export function ResultSearch({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const focus = useFocusStyle();
  return (
    <View style={styles.search}>
      <TextField
        label="Search these restrooms"
        hint="Type a name, street or town to narrow the restrooms listed below."
        value={value}
        onChangeText={onChange}
        returnKeyType="search"
        autoCapitalize="none"
      />
      {value.trim() ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChange('')}
          {...focus.handlers}
          style={[styles.clear, focus.style]}
        >
          <Icon name="close" size={16} color={colors.primaryStrong} />
          <Text style={styles.clearText}>Clear search</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { opacity: 0.85 },
  hero: { backgroundColor: colors.hero, borderRadius: radii.lg + 4, padding: spacing.lg, gap: spacing.sm, ...shadows.hero },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.onHero, alignItems: 'center', justifyContent: 'center' },
  heroKicker: { ...typography.label, color: colors.heroMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  heroName: { fontSize: 24, lineHeight: 30, fontWeight: '700', color: colors.onHero },
  heroDistanceRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: spacing.sm },
  heroDistance: { fontSize: 36, lineHeight: 42, fontWeight: '800', color: colors.onHero },
  heroTravel: { ...typography.heading, fontSize: 18, color: colors.heroMuted },
  heroSub: { ...typography.body, color: colors.heroMuted },
  heroFacts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  heroFact: { ...typography.label, color: colors.hero, backgroundColor: colors.onHero, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.pill, overflow: 'hidden' },
  heroActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  heroBtn: { minHeight: touchTarget.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radii.pill, flexGrow: 1, flexBasis: 140 },
  heroBtnPrimary: { backgroundColor: colors.onHero },
  heroBtnGhost: { borderWidth: 2, borderColor: colors.onHero },
  heroBtnText: { ...typography.heading, fontSize: 17 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tileCell: { flexGrow: 1, flexBasis: 150, minWidth: 140, flexDirection: 'column' },
  tile: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 72, padding: spacing.sm + 2, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadows.card },
  tileIcon: { width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  tileText: { flex: 1, gap: 1 },
  tileLabel: { ...typography.label, fontSize: 16, lineHeight: 20, color: colors.text },
  tileHint: { ...typography.label, fontWeight: '400', color: colors.textMuted },
  search: { gap: spacing.xs },
  clear: { minHeight: touchTarget.min, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, marginLeft: -spacing.sm, borderRadius: radii.md },
  clearText: { ...typography.label, color: colors.primaryStrong, textDecorationLine: 'underline' },
});
