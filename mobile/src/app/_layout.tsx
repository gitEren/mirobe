import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import {
  CormorantGaramond_500Medium,
  CormorantGaramond_500Medium_Italic,
} from '@expo-google-fonts/cormorant-garamond';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { BrandSplash } from '@/components/brand';
import { InAppNotices, NotificationsHost } from '@/components/Notifications';
import { configureBilling } from '@/lib/billing';
import { boot, useStore } from '@/lib/store';
import { colors } from '@/lib/theme';

void SplashScreen.preventAutoHideAsync();
boot();

export default function RootLayout() {
  const insets = useSafeAreaInsets();
  const [fontsLoaded, fontError] = useFonts({
    CormorantGaramond_500Medium,
    CormorantGaramond_500Medium_Italic,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });
  const ready = useStore((s) => s.ready);
  const userId = useStore((s) => s.userId);
  const [splashDone, setSplashDone] = useState(false);
  // A font that failed to load falls back to the system font rather than keeping the splash up.
  const fontsReady = fontsLoaded || Boolean(fontError);

  // RevenueCat follows the account: logIn on every user switch, logOut on sign-out / deletion.
  useEffect(() => {
    configureBilling(userId);
  }, [userId]);

  // The native splash stays up until BrandSplash has drawn the same mark over the app.
  if (!fontsReady || !ready) return null;

  // iOS shows 'modal' screens as a sheet below the status bar. Android shows them full screen
  // and edge to edge, so they start below the status bar there.
  const modal =
    Platform.OS === 'android'
      ? ({ presentation: 'modal', contentStyle: { backgroundColor: colors.ivory, paddingTop: insets.top } } as const)
      : ({ presentation: 'modal' } as const);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.ivory }}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ivory } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="welcome" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="mirror" options={{ presentation: 'fullScreenModal', contentStyle: { backgroundColor: colors.night } }} />
        <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', contentStyle: { backgroundColor: colors.night } }} />
        <Stack.Screen name="avatar" options={{ presentation: 'fullScreenModal', contentStyle: { backgroundColor: colors.night } }} />
        <Stack.Screen name="stylist" options={modal} />
        <Stack.Screen name="garment/[id]" options={modal} />
        <Stack.Screen name="look/[id]" />
        <Stack.Screen name="tryons" />
        <Stack.Screen name="tryon/[id]" options={{ presentation: 'fullScreenModal', contentStyle: { backgroundColor: colors.night } }} />
        <Stack.Screen name="paywall" options={modal} />
        <Stack.Screen name="login" options={modal} />
        <Stack.Screen name="register" options={modal} />
        <Stack.Screen name="delete-account" options={modal} />
        {/* Consent to AI processing: a sheet over whichever screen started the AI action. */}
        <Stack.Screen name="ai-consent" options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }} />
      </Stack>
      {/* Push token, daily reminders, notification taps and the permission explainer. */}
      <NotificationsHost />
      {/* Notices the server leaves for the app instead of a push (auto-renew back on, …). */}
      <InAppNotices />
      {splashDone ? null : <BrandSplash onShown={() => void SplashScreen.hideAsync()} onDone={() => setSplashDone(true)} />}
    </GestureHandlerRootView>
  );
}
