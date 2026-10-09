import { colors, layout, spacing, typography } from '@open-stall/ui';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, type ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type Props = { title: string; subtitle?: string; children?: ReactNode; /** Forms and account pages: a narrower, easier-to-read column on large screens. */ form?: boolean;
  /**
   * Web: move keyboard/screen-reader focus to the page heading when this screen is opened (detail, forms, sign-in).
   * Without it, focus stays on the control that opened the screen, which is now hidden. Leave off for the tab roots,
   * where moving focus out of the tab bar would be disorienting.
   */
  moveFocus?: boolean };

/** Page frame: scrolls, respects safe areas, and keeps content to a readable width on large screens. */
/** The page heading can take programmatic focus (not a Tab stop). */
const focusable = { tabIndex: -1 } as object;

export function Screen({ title, subtitle, children, form = false, moveFocus = false }: Props) {
  const headingRef = useRef<{ focus?: (o?: { preventScroll?: boolean }) => void } | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!moveFocus || Platform.OS !== 'web') return undefined;
      const t = setTimeout(() => headingRef.current?.focus?.({ preventScroll: true }), 50);
      return () => clearTimeout(t);
    }, [moveFocus]),
  );
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View role="main" style={[styles.content, form && styles.form]}>
          <View style={styles.header}>
            <Text ref={headingRef as never} {...focusable} accessibilityRole="header" aria-level={1} style={styles.title}>
              {title}
            </Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          {children}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { alignItems: 'center' },
  content: { width: '100%', maxWidth: layout.maxContentWidth, padding: spacing.md, gap: spacing.md },
  form: { maxWidth: layout.formMaxWidth },
  header: { gap: spacing.xs },
  // Programmatic focus (moveFocus) is for screen readers and keyboard position; a heading is not operable, so no ring.
  title: { ...typography.title, color: colors.text, outlineStyle: 'none' as never },
  subtitle: { ...typography.body, color: colors.textMuted },
});
