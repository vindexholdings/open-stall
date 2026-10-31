import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { enableScreens } from 'react-native-screens';
import { AuthProvider } from '../auth/AuthProvider';
import { installGlobalWebStyles } from '../web/globalStyles';

installGlobalWebStyles();
// Web: without this the navigator leaves visited screens in the page (aria-hidden but still focusable and tabbable, stacked
// behind the active screen). Enabled, inactive screens are display:none yet stay mounted, so their state is kept.
if (Platform.OS === 'web') enableScreens(true);

/**
 * Root navigation (D3): a real stack. `(tabs)` is the main four-destination navigator; a restroom, the add/correct and report
 * forms and sign-in are pushed on top of whatever opened them. Every push is its own history entry that keeps its own route
 * AND parameters (Home -> Details A -> Favorites -> Details B -> Back -> Back returns to Details A), and on iOS and Android the
 * native stack supplies the edge-swipe / system Back. URLs are unchanged: `(tabs)` is a group, not a path segment.
 */
export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="location/[id]" options={{ title: 'Restroom' }} />
        <Stack.Screen name="contribute" options={{ title: 'Add restroom' }} />
        <Stack.Screen name="report" options={{ title: 'Report a problem' }} />
        <Stack.Screen name="auth/sign-in" options={{ title: 'Sign in' }} />
        <Stack.Screen name="auth/callback" options={{ title: 'Signing in' }} />
        <Stack.Screen name="auth/reset" options={{ title: 'Reset password' }} />
      </Stack>
    </AuthProvider>
  );
}
