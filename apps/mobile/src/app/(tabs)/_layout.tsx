import { Tabs } from 'expo-router/js-tabs';
import { MainNav, type MainNavProps } from '../../components/MainNav';

/**
 * The four main destinations. They switch in place (Nearby, Favorites, Account, Settings) and keep their own tab history so
 * Back after a tab press returns to the previous tab. Everything that is OPENED from them (a restroom, a form, sign-in) is a
 * real stack screen in the root layout, which is what gives each opened screen its own history entry with its own
 * parameters and the native back gesture.
 */
export default function TabsLayout() {
  return (
    <Tabs backBehavior="history" screenOptions={{ headerShown: false }} tabBar={(props) => <MainNav {...(props as unknown as MainNavProps)} />}>
      <Tabs.Screen name="index" options={{ title: 'Nearby', tabBarAccessibilityLabel: 'Nearby restrooms' }} />
      <Tabs.Screen name="favorites" options={{ title: 'Favorites' }} />
      <Tabs.Screen name="account" options={{ title: 'Account' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
