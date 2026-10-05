import { colors, touchTarget, typography } from '@open-stall/ui';
import { StatusBar } from 'expo-status-bar';
import { Tabs } from 'expo-router/js-tabs';
import { AuthProvider } from '../auth/AuthProvider';

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primaryStrong,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: { backgroundColor: colors.surface, minHeight: touchTarget.primary },
          tabBarLabelStyle: { fontSize: typography.label.fontSize, fontWeight: typography.label.fontWeight },
          tabBarIconStyle: { display: 'none' },
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Nearby', tabBarAccessibilityLabel: 'Nearby restrooms' }} />
        <Tabs.Screen name="favorites" options={{ title: 'Favorites' }} />
        <Tabs.Screen name="location/[id]" options={{ href: null, title: 'Restroom' }} />
        <Tabs.Screen name="account" options={{ title: 'Account' }} />
        <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
        <Tabs.Screen name="contribute" options={{ href: null, title: 'Add a restroom' }} />
        <Tabs.Screen name="report" options={{ href: null, title: 'Report a problem' }} />
        <Tabs.Screen name="auth/sign-in" options={{ href: null, title: 'Sign in' }} />
        <Tabs.Screen name="auth/callback" options={{ href: null, title: 'Signing in' }} />
        <Tabs.Screen name="auth/reset" options={{ href: null, title: 'Reset password' }} />
      </Tabs>
    </AuthProvider>
  );
}
