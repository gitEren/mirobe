import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowUpRight, X } from 'lucide-react-native';
import { PASSWORD_MAX_LENGTH } from '@mirobe/shared';
import { Field } from '@/components/auth';
import { Banner, Button, IconButton, Txt, haptic } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { deleteAccount, useStore, useStrings } from '@/lib/store';
import { colors, fonts, radius } from '@/lib/theme';

/** Store subscriptions outlive the account: they are cancelled in the store, not here. */
const SUBSCRIPTIONS_URL =
  Platform.OS === 'ios' ? 'https://apps.apple.com/account/subscriptions' : 'https://play.google.com/store/account/subscriptions';

/**
 * In-app account deletion (App Store 5.1.1(v)). A registered account confirms
 * with its password; the server deletes the rows and photos, then this device
 * is cleared like a sign-out and continues on a fresh anonymous account.
 */
export default function DeleteAccount() {
  const t = useStrings();
  const insets = useSafeAreaInsets();
  const email = useStore((s) => s.email);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsPassword = Boolean(email);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/profile'));

  const submit = async () => {
    if (busy || (needsPassword && !password)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(needsPassword ? password : undefined);
      void haptic('success');
      close();
      Alert.alert(t.profile.deleted, t.profile.deletedBody);
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : undefined;
      setError(
        caught instanceof ApiError && caught.isNetwork
          ? t.auth.network
          : code === 'INVALID_CREDENTIALS'
            ? t.profile.deleteWrongPassword
            : code === 'RATE_LIMITED'
              ? t.auth.rateLimited
              : t.common.error
      );
      void haptic('warning');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.ivory }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 20, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <IconButton accessibilityLabel={t.common.close} tone="stone" onPress={close}>
            <X size={18} color={colors.charcoal} />
          </IconButton>
        </View>

        <View style={{ marginTop: 24 }}>
          <Txt variant="label" style={{ marginBottom: 12 }}>
            {t.profile.deleteKicker}
          </Txt>
          <Txt variant="display" style={{ fontSize: 42, lineHeight: 46 }}>
            {t.profile.deleteTitle}
          </Txt>
          <Txt variant="body" style={{ color: colors.warmGray, marginTop: 12, fontSize: 15, lineHeight: 22 }}>
            {t.profile.deleteBody}
          </Txt>
          {email ? (
            <Txt variant="bodyStrong" style={{ marginTop: 10 }} numberOfLines={1} ellipsizeMode="middle">
              {email}
            </Txt>
          ) : null}
        </View>

        <View style={styles.subscription}>
          <Txt variant="bodyStrong">{t.profile.deleteSubscriptionTitle}</Txt>
          <Txt variant="caption" style={{ marginTop: 4, lineHeight: 18 }}>
            {t.profile.deleteSubscriptionBody}
          </Txt>
          <Pressable onPress={() => void Linking.openURL(SUBSCRIPTIONS_URL)} accessibilityRole="link" style={styles.link} hitSlop={8}>
            <Txt variant="caption" style={{ color: colors.charcoal, fontFamily: fonts.sansSemi }}>
              {t.profile.deleteManageSubscriptions}
            </Txt>
            <ArrowUpRight size={14} color={colors.charcoal} />
          </Pressable>
        </View>

        {needsPassword ? (
          <View style={{ marginTop: 28 }}>
            <Field
              label={t.profile.deletePassword}
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                setError(null);
              }}
              placeholder={t.auth.passwordPlaceholder}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              textContentType="password"
              maxLength={PASSWORD_MAX_LENGTH}
              returnKeyType="done"
              onSubmitEditing={() => void submit()}
              editable={!busy}
            />
          </View>
        ) : null}

        {error ? (
          <View style={{ marginTop: 20 }}>
            <Banner tone="warning" text={error} />
          </View>
        ) : null}

        <View style={{ flex: 1, minHeight: 32 }} />

        <Button
          title={t.profile.deleteConfirm}
          tone="danger"
          size="lg"
          loading={busy}
          disabled={needsPassword && !password}
          onPress={() => void submit()}
        />
        <Button title={t.common.cancel} tone="ghost" style={{ marginTop: 10 }} disabled={busy} onPress={close} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  subscription: {
    marginTop: 24,
    padding: 16,
    borderRadius: radius.lg,
    backgroundColor: colors.stone,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10, alignSelf: 'flex-start' },
});
