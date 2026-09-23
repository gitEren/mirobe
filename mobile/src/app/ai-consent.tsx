import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ShieldCheck, Sparkles } from 'lucide-react-native';
import { Banner, Button, Txt } from '@/components/ui';
import { PRIVACY_URL } from '@/lib/billing';
import { answerConsentRequest, consentSheetOpened, getState, setAiConsent, useStore, useStrings } from '@/lib/store';
import { colors, fonts, radius } from '@/lib/theme';

/**
 * Consent to AI processing (App Store 5.1.2(i)), asked by ensureAiConsent over whichever screen
 * started an AI action. A transparent modal route rather than a <Modal> in the root layout: most
 * AI actions start on modal screens (Jev, the mirror, a garment), which a root <Modal> cannot
 * cover. Same look as the notifications explainer (components/Notifications.tsx). "Allow"
 * records the consent and the action goes on; "Not now", the backdrop or back leave it undone.
 */
export default function AiConsentSheet() {
  const t = useStrings();
  const lang = useStore((s) => s.lang);
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    consentSheetOpened();
    // Closed without an answer (Android back, a link, …): the waiting action does not run.
    return () => answerConsentRequest(false);
  }, []);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const allow = async () => {
    setBusy(true);
    setError(null);
    try {
      await setAiConsent(true);
      answerConsentRequest(getState().aiConsent);
      close();
    } catch {
      setError(t.consent.saveFailed);
      setBusy(false);
    }
  };

  const later = () => {
    answerConsentRequest(false);
    close();
  };

  return (
    <View style={styles.backdrop} accessibilityViewIsModal>
      <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : later} accessibilityLabel={t.consent.later} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
        {/* On a small screen the text scrolls; the two buttons always stay in view. */}
        <ScrollView bounces={false} showsVerticalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 1 }}>
          <View style={styles.icon}>
            <Sparkles size={20} color={colors.amber} />
          </View>
          <Txt variant="title" style={{ marginTop: 16 }}>
            {t.consent.title}
          </Txt>
          <Txt variant="body" style={{ marginTop: 8 }}>
            {t.consent.body}
          </Txt>
          <Txt variant="body" style={{ color: colors.warmGray, marginTop: 8 }}>
            {t.consent.models}
          </Txt>
          <View style={{ marginTop: 16 }}>
            <Reason icon={<ShieldCheck size={15} color={colors.amber} />} text={t.consent.use} />
          </View>
          <Txt
            variant="caption"
            style={styles.link}
            accessibilityRole="link"
            onPress={() => void Linking.openURL(`${PRIVACY_URL}?lang=${lang}`)}
          >
            {t.consent.privacy}
          </Txt>
        </ScrollView>
        {error ? (
          <View style={{ marginTop: 16 }}>
            <Banner tone="warning" text={error} />
          </View>
        ) : null}
        <Button title={t.consent.allow} size="lg" loading={busy} onPress={() => void allow()} style={{ marginTop: 20 }} />
        <Button title={t.consent.later} tone="ghost" disabled={busy} onPress={later} style={{ marginTop: 10 }} />
      </View>
    </View>
  );
}

function Reason({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <View style={styles.reason}>
      <View style={styles.reasonIcon}>{icon}</View>
      <Txt variant="body" style={{ flex: 1 }}>
        {text}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(26,25,24,0.4)' },
  sheet: {
    maxHeight: '92%',
    paddingHorizontal: 24,
    paddingTop: 24,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.ivory,
  },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.charcoal, alignItems: 'center', justifyContent: 'center' },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  reasonIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.charcoal, alignItems: 'center', justifyContent: 'center' },
  link: { marginTop: 16, alignSelf: 'flex-start', color: colors.charcoal, fontFamily: fonts.sansSemi, textDecorationLine: 'underline' },
});
