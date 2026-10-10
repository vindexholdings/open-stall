import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { enableScreens } from 'react-native-screens';
import { Tabs } from 'expo-router/js-tabs';
import { AuthProvider } from '../auth/AuthProvider';
import { MainNav, type MainNavProps } from '../components/MainNav';
import { installGlobalWebStyles } from '../web/globalStyles';

installGlobalWebStyles();
// Web: without this the navigator leaves visited screens in the page (aria-hidden but still focusable and tabbable, stacked
// behind the active screen). Enabled, inactive screens are display:none yet stay mounted, so their state is kept.
if (Platform.OS === 'web') enableScreens(true);

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <MainNav {...(props as unknown as MainNavProps)} />}>
        <Tabs.Screen name="index" options={{ title: 'Nearby', tabBarAccessibilityLabel: 'Nearby restrooms' }} />
        <Tabs.Screen name="favorites" options={{ title: 'Favorites' }} />
        <Tabs.Screen name="location/[id]" options={{ href: null, title: 'Restroom' }} />
        <Tabs.Screen name="account" options={{ title: 'Account' }} />
        <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
        <Tabs.Screen name="contribute" options={{ href: null, title: 'Add restroom' }} />
        <Tabs.Screen name="report" options={{ href: null, title: 'Report a problem' }} />
        <Tabs.Screen name="auth/sign-in" options={{ href: null, title: 'Sign in' }} />
        <Tabs.Screen name="auth/callback" options={{ href: null, title: 'Signing in' }} />
        <Tabs.Screen name="auth/reset" options={{ href: null, title: 'Reset password' }} />
      </Tabs>
    </AuthProvider>
  );
}
