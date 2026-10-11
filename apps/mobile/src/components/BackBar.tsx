import { colors, spacing, touchTarget, typography } from '@open-stall/ui';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';
import { useFocusStyle } from './focus';

type Props = {
  /**
   * 'pushed': a screen reached from another (details, forms, sign-in). Shows "Back" when there is real history, otherwise an
   * explicitly named safe destination, never a Home reset labeled as Back.
   * 'history': a top-level screen that also gets Back when it was opened from another screen, and nothing otherwise.
   */
  mode: 'pushed' | 'history';
};

/**
 * History-aware Back. "Back" always returns to the actual previous screen (the navigator keeps the tab history, and
 * the discovery screen keeps its search, filters and List|Map choice). With no usable history (a direct link, a reload,
 * a deep link) the control says where it goes: "Nearby restrooms".
 */
export function BackBar({ mode }: Props) {
  const router = useRouter();
  const focus = useFocusStyle();
  const [canGoBack, setCanGoBack] = useState(() => router.canGoBack());
  // The screen stays mounted between visits, so re-read the history each time it comes into focus.
  useFocusEffect(
    useCallback(() => {
      setCanGoBack(router.canGoBack());
    }, [router]),
  );
  if (!canGoBack && mode === 'history') return null;
  const goBack = canGoBack;
  return (
    <View style={styles.bar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={goBack ? 'Back' : 'Go to nearby restrooms'}
        accessibilityHint={goBack ? 'Returns to the previous screen.' : 'Opens the nearby restrooms screen.'}
        onPress={() => (goBack ? router.back() : router.replace('/'))}
        {...focus.handlers}
        style={({ pressed }) => [styles.button, pressed && styles.pressed, focus.style]}
      >
        <Icon name={goBack ? 'back' : 'pin'} size={20} color={colors.primaryStrong} inner={colors.background} />
        <Text style={styles.label}>{goBack ? 'Back' : 'Nearby restrooms'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row' },
  button: { minHeight: touchTarget.min, flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, paddingRight: spacing.md, paddingLeft: spacing.xs },
  pressed: { opacity: 0.7 },
  label: { ...typography.label, fontSize: 16, color: colors.primaryStrong },
});
