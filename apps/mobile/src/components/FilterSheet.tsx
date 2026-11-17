import { DEFAULT_FILTERS, RADIUS_CHOICES_MILES, radiusMetersForMiles, type LocationFilters } from '@open-stall/domain';
import { colors, radii, shadows, spacing, touchTarget, typography } from '@open-stall/ui';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Checkbox } from './Checkbox';
import { Icon } from './Icon';
import { PrimaryButton } from './PrimaryButton';
import { RadioGroup } from './RadioGroup';
import { SecondaryButton } from './SecondaryButton';
import { useFocusStyle } from './focus';

const RADIUS_OPTIONS = RADIUS_CHOICES_MILES.map((mi) => ({ value: Math.round(radiusMetersForMiles(mi)), label: `${mi} mi` }));
const RATING_OPTIONS: readonly { value: number | null; label: string }[] = [
  { value: null, label: 'Any rating' },
  { value: 3, label: '3+' },
  { value: 4, label: '4+' },
];
const KEY_OPTIONS = [
  { value: 'any', label: 'Any' }, { value: 'required', label: 'Required' }, { value: 'not_required', label: 'Not required' },
] as const;
const PURCHASE_OPTIONS = [
  { value: 'any', label: 'Any' }, { value: 'required', label: 'Required' }, { value: 'free', label: 'Not required' },
] as const;

/** True when the OS or browser asks for less motion; the sheet then opens without sliding. */
function useReducedMotion(): boolean {
  const query = () => (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null);
  const [reduced, setReduced] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    let live = true;
    if (Platform.OS === 'web') {
      const mq = query();
      if (!mq) return undefined;
      const on = (e: MediaQueryListEvent) => setReduced(e.matches);
      mq.addEventListener?.('change', on);
      return () => mq.removeEventListener?.('change', on);
    }
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => live && setReduced(v)).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" aria-level={3} style={styles.groupTitle}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

type Props = {
  visible: boolean;
  /** The filters currently applied. The sheet edits a DRAFT copy; nothing changes until Apply. */
  applied: LocationFilters;
  onApply: (next: LocationFilters) => void;
  /** Dismiss without applying (Cancel, the close button, Escape, the Android back button, or a tap outside). */
  onDismiss: () => void;
};

/**
 * The filter chooser: a modal sheet on phones and a centered panel on wide screens (same component). It is a real dialog
 * named "Filters": focus enters it, stays inside it, and returns to the control that opened it; Escape and the native
 * request-close dismiss it; the background is inert for screen readers. Choices are a DRAFT: Apply commits the whole
 * draft at once, Cancel/dismiss discards it, and Clear resets the draft (visibly) so Apply is what commits the reset.
 */
export function FilterSheet({ visible, applied, onApply, onDismiss }: Props) {
  const reduced = useReducedMotion();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduced ? 'none' : 'slide'}
      onRequestClose={onDismiss}
      statusBarTranslucent
      aria-label="Filters"
    >
      {visible ? <SheetBody applied={applied} onApply={onApply} onDismiss={onDismiss} /> : null}
    </Modal>
  );
}

function SheetBody({ applied, onApply, onDismiss }: Omit<Props, 'visible'>) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= 700;
  const [draft, setDraft] = useState<LocationFilters>(applied);
  const set = (patch: Partial<LocationFilters>) => setDraft((d) => ({ ...d, ...patch }));
  const closeFocus = useFocusStyle();
  const radiusValue = RADIUS_OPTIONS.find((o) => o.value === Math.round(draft.radiusMeters))?.value ?? -1;
  return (
    <View style={[styles.backdropWrap, wide && styles.backdropWide]}>
      {/* A tap outside the sheet dismisses it. It is not a control for assistive technology: Cancel and Escape do the same. */}
      <Pressable accessible={false} importantForAccessibility="no" aria-hidden onPress={onDismiss} style={StyleSheet.absoluteFill} />
      <View
        accessibilityViewIsModal
        style={[styles.sheet, wide ? styles.sheetWide : { maxHeight: height * 0.92, paddingBottom: Math.max(insets.bottom, spacing.sm) }, shadows.hero]}
      >
        <View style={styles.header}>
          <Text accessibilityRole="header" aria-level={2} style={styles.title}>Filters</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel and close filters"
            onPress={onDismiss}
            {...closeFocus.handlers}
            style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed, closeFocus.style]}
          >
            <Icon name="close" size={20} color={colors.text} />
            <Text style={styles.closeText}>Cancel</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Group title="Distance">
            <RadioGroup label="Distance" options={RADIUS_OPTIONS} value={radiusValue} onChange={(v) => set({ radiusMeters: v })} />
          </Group>
          <Group title="Rating">
            <RadioGroup label="Minimum rating" options={RATING_OPTIONS} value={draft.minRating} onChange={(v) => set({ minRating: v })} />
          </Group>
          <Group title="Verification">
            <Checkbox label="Verified only" checked={draft.verifiedOnly} onChange={(v) => set({ verifiedOnly: v })} />
          </Group>
          <Group title="Features" hint="Only restrooms known to have each feature are shown.">
            <View role="group" aria-label="Features">
              <Checkbox label="Wheelchair accessible" checked={draft.wheelchairAccessible} onChange={(v) => set({ wheelchairAccessible: v })} />
              <Checkbox label="Gender-neutral" checked={draft.genderNeutral} onChange={(v) => set({ genderNeutral: v })} />
              <Checkbox label="Baby changing" checked={draft.babyChanging} onChange={(v) => set({ babyChanging: v })} />
              <Checkbox label="Hot water" checked={draft.hotWater} onChange={(v) => set({ hotWater: v })} />
              <Checkbox label="Cold water only" checked={draft.coldWaterOnly} onChange={(v) => set({ coldWaterOnly: v })} />
            </View>
          </Group>
          <Group title="Access" hint="Restrooms where this isn’t reported are hidden when you choose Required or Not required.">
            <Text style={styles.subLabel}>Key</Text>
            <RadioGroup label="Key needed" options={KEY_OPTIONS} value={draft.key} onChange={(v) => set({ key: v })} />
            <Text style={styles.subLabel}>Purchase</Text>
            <RadioGroup label="Purchase needed" options={PURCHASE_OPTIONS} value={draft.purchase} onChange={(v) => set({ purchase: v })} />
          </Group>
        </ScrollView>
        <View style={styles.footer}>
          <View style={styles.footerBtn}>
            <SecondaryButton tall label="Clear" onPress={() => setDraft(DEFAULT_FILTERS)} accessibilityHint="Resets your choices in this sheet. Apply filters to use them." />
          </View>
          <View style={styles.footerBtn}>
            <PrimaryButton label="Apply filters" onPress={() => onApply(draft)} />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdropWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15, 23, 42, 0.45)' },
  backdropWide: { justifyContent: 'center', alignItems: 'center' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radii.lg + 4, borderTopRightRadius: radii.lg + 4, width: '100%', overflow: 'hidden' },
  sheetWide: { width: 560, maxWidth: '92%', maxHeight: '86%', borderRadius: radii.lg + 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs },
  title: { ...typography.heading, color: colors.text },
  closeBtn: { minHeight: touchTarget.min, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm },
  closeText: { ...typography.label, fontSize: 15, color: colors.text },
  pressed: { opacity: 0.8 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  scrollContent: { gap: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  group: { gap: spacing.xs + 2 },
  groupTitle: { ...typography.label, fontSize: 15, color: colors.text },
  hint: { ...typography.label, fontWeight: '400', color: colors.textMuted },
  subLabel: { ...typography.label, fontWeight: '500', color: colors.textMuted, marginTop: spacing.xs },
  footer: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  footerBtn: { flexGrow: 1, flexBasis: 140 },
});
