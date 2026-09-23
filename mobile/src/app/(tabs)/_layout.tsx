import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { TabBar } from '@/components/TabBar';
import { useAiConsentAfterSignIn, useStore } from '@/lib/store';
import { colors } from '@/lib/theme';

export default function TabsLayout() {
  const onboarded = useStore((s) => s.onboarded);
  // Right after sign-up / sign-in: the consent to AI processing is asked once, here.
  useAiConsentAfterSignIn();
  if (!onboarded) return <Redirect href="/welcome" />;
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.ivory } }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="wardrobe" />
      <Tabs.Screen name="looks" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
