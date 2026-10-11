import { colors, radii, tiles, touchTarget, typography } from '@open-stall/ui';
import { Link } from 'expo-router';
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from './Icon';
import { useFocusStyle } from './focus';

/** The slice of the navigator's tab-bar props that is used here (the navigator library is not a direct dependency). */
export type MainNavProps = {
  state: { index: number; routes: { key: string; name: string }[] };
  descriptors: Record<string, { options: { title?: string; href?: string | null; tabBarAccessibilityLabel?: string } }>;
  navigation: { navigate: (name: string) => void };
};

const HREF: Record<string, string> = { index: '/', favorites: '/favorites', account: '/account', settings: '/settings' };
const ICON: Record<string, IconName> = { index: 'pin', favorites: 'heart', account: 'user', settings: 'filter' };

/**
 * The app's main navigation. Web: a labeled `navigation` landmark of ordinary links (Tab, Enter, `aria-current="page"`),
 * not an ARIA tablist, because a tablist promises arrow-key behavior this bar does not have. Native: a real tab bar
 * (role tab + selected state), where screen readers provide the tab gestures themselves.
 */
export function MainNav({ state, descriptors, navigation }: MainNavProps) {
  const insets = useSafeAreaInsets();
  const items = state.routes
    .map((route, i) => ({ route, focused: state.index === i, options: descriptors[route.key]?.options ?? {} }))
    .filter((x) => x.options.href !== null && HREF[x.route.name] !== undefined);
  const isWeb = Platform.OS === 'web';
  return (
    <View
      {...(isWeb ? { role: 'navigation', 'aria-label': 'Main' } : { accessibilityRole: 'tablist' })}
      style={[styles.bar, { paddingBottom: insets.bottom }]}
    >
      {items.map(({ route, focused, options }) => {
        const label = options.title ?? route.name;
        const spoken = options.tabBarAccessibilityLabel ?? label;
        const tint = focused ? colors.primaryStrong : colors.textMuted;
        const labelStyle = [styles.label, { color: tint }];
        const content = (
          <>
            <View style={[styles.pill, focused && styles.pillOn]}><Icon name={ICON[route.name] ?? 'pin'} size={22} color={tint} inner={focused ? tiles.blue.bg : colors.surface} /></View>
            <Text style={labelStyle}>{label}</Text>
          </>
        );
        return isWeb ? (
          <NavLink key={route.key} href={HREF[route.name]!} spoken={spoken} current={focused} style={styles.item}>
            {content}
          </NavLink>
        ) : (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityLabel={spoken}
            accessibilityState={{ selected: focused }}
            onPress={() => navigation.navigate(route.name)}
            style={styles.item}
          >
            {content}
          </Pressable>
        );
      })}
    </View>
  );
}

/** One navigation link. The focus ring is applied from focus state (like every other control), not only from :focus-visible. */
function NavLink({ href, spoken, current, style, children }: { href: string; spoken: string; current: boolean; style: unknown; children: ReactNode }) {
  const focus = useFocusStyle();
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={spoken}
        aria-current={current ? 'page' : undefined}
        {...focus.handlers}
        // A single flat object: expo-router's Slot merges the child's style by spreading it, which would turn an array into "0", "1" keys.
        style={StyleSheet.flatten([style as never, focus.style ? { ...focus.style, outlineOffset: -3 } : null])}
      >
        {children}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  item: { flex: 1, minHeight: touchTarget.primary, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 6 },
  pill: { width: 56, height: 30, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: tiles.blue.bg },
  label: { fontSize: typography.label.fontSize, lineHeight: typography.label.lineHeight, fontWeight: typography.label.fontWeight, textAlign: 'center' },
});
