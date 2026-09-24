import { Platform, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Wordmark } from '@/components/brand';
import { Button, Chip, Txt } from '@/components/ui';
import { completeOnboarding, setLang, useStore, useStrings } from '@/lib/store';
import { colors, fonts } from '@/lib/theme';

export default function Welcome() {
  const t = useStrings();
  const lang = useStore((s) => s.lang);
  const insets = useSafeAreaInsets();
  const steps = [t.welcome.step1, t.welcome.step2, t.welcome.step3];

  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 20, paddingHorizontal: 24 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Wordmark size={30} />
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Chip small label="TR" active={lang === 'tr'} onPress={() => setLang('tr')} />
          <Chip small label="EN" active={lang === 'en'} onPress={() => setLang('en')} />
        </View>
      </View>

      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Txt variant="label" style={{ marginBottom: 14 }}>
          AI · wardrobe · mirror
        </Txt>
        <Txt variant="display" style={{ fontSize: 52, lineHeight: 54 }}>
          {t.welcome.title}
        </Txt>
        <Txt variant="body" style={{ color: colors.warmGray, marginTop: 18, fontSize: 15, lineHeight: 22 }}>
          {t.welcome.body}
        </Txt>

        <View style={{ marginTop: 36, gap: 18 }}>
          {steps.map((step, index) => (
            <View key={step} style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              {/* The body variant's 20pt line box clips the 30pt old-style figures on Android (iOS draws past it). */}
              <Txt style={{ fontFamily: fonts.serifItalic, fontSize: 30, color: colors.mutedGray, width: 30, ...(Platform.OS === 'android' && { lineHeight: 40 }) }}>
                {index + 1}
              </Txt>
              <View style={{ flex: 1, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
                <Txt variant="bodyStrong">{step}</Txt>
              </View>
            </View>
          ))}
        </View>
      </View>

      <Button
        title={t.welcome.start}
        size="lg"
        onPress={() => {
          completeOnboarding();
          router.replace('/');
        }}
      />
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          completeOnboarding();
          router.replace('/');
          router.push('/login');
        }}
        style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, paddingTop: 16 }}
      >
        <Txt variant="caption">{t.auth.haveAccount}</Txt>
        <Txt variant="caption" style={{ color: colors.charcoal, fontFamily: fonts.sansSemi }}>
          {t.auth.toLogin}
        </Txt>
      </Pressable>
    </View>
  );
}
