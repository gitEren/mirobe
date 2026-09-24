import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@mirobe/shared';
import { Wordmark } from '@/components/brand';
import { Banner, Button, IconButton, Txt, haptic } from '@/components/ui';
import { ApiError } from '@/lib/api';
import type { Strings } from '@/lib/i18n';
import { registerAccount, setAccountScreenOpen, signIn, useStore, useStrings } from '@/lib/store';
import { colors, fonts } from '@/lib/theme';

type Mode = 'login' | 'register';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(mode: Mode, email: string, password: string, t: Strings) {
  const errors: { email?: string; password?: string } = {};
  if (!EMAIL_PATTERN.test(email.trim())) errors.email = t.auth.invalidEmail;
  if (!password) errors.password = t.auth.passwordRequired;
  else if (mode === 'register' && password.length < PASSWORD_MIN_LENGTH) errors.password = t.auth.passwordTooShort;
  else if (password.length > PASSWORD_MAX_LENGTH) errors.password = t.auth.passwordTooLong;
  return errors;
}

function serverMessage(error: unknown, t: Strings): string {
  const code = error instanceof ApiError ? error.code : undefined;
  if (error instanceof ApiError && error.isNetwork) return t.auth.network;
  if (code === 'EMAIL_TAKEN') return t.auth.emailTaken;
  if (code === 'INVALID_CREDENTIALS') return t.auth.invalidCredentials;
  if (code === 'RATE_LIMITED') return t.auth.rateLimited;
  return t.common.error;
}

/**
 * Sign in / sign up. Opened as a modal, usually by `requireAccount()` in front
 * of the screen that wanted an AI feature; on success it goes back there, or to
 * `next` when there is nothing to go back to. Opened by `openWithAccount()` /
 * `useAccountGate()` instead, it continues into `next` (the scan screen, …).
 */
export function AuthForm({ mode }: { mode: Mode }) {
  const t = useStrings();
  const insets = useSafeAreaInsets();
  const hasLocalPieces = useStore((s) => s.garments.length > 0);
  /** `open`: the gate stood in front of `next` (camera, mirror, Jev), so signing in continues into it. */
  const { next, open } = useLocalSearchParams<{ next?: string; open?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const isLogin = mode === 'login';

  useEffect(() => {
    setAccountScreenOpen(true);
    return () => setAccountScreenOpen(false);
  }, []);

  const errors = submitted ? validate(mode, email, password, t) : {};

  const finish = () => {
    if (open && next) router.replace(next as Href);
    else if (router.canGoBack()) router.back();
    else router.replace((next || '/') as Href);
  };

  const submit = async () => {
    if (busy) return;
    setSubmitted(true);
    setServerError(null);
    const found = validate(mode, email, password, t);
    if (found.email || found.password) {
      void haptic('warning');
      return;
    }
    setBusy(true);
    try {
      if (isLogin) await signIn(email.trim(), password);
      else await registerAccount(email.trim(), password);
      void haptic('success');
      finish();
    } catch (error) {
      setServerError(serverMessage(error, t));
      void haptic('warning');
    } finally {
      setBusy(false);
    }
  };

  const switchMode = () =>
    router.replace({ pathname: isLogin ? '/register' : '/login', params: { ...(next ? { next } : {}), ...(open ? { open } : {}) } });

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.ivory }} behavior="padding">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 20, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Wordmark size={26} />
          <IconButton accessibilityLabel={t.common.close} tone="stone" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
            <X size={18} color={colors.charcoal} />
          </IconButton>
        </View>

        <View style={{ marginTop: 44 }}>
          <Txt variant="label" style={{ marginBottom: 12 }}>
            {isLogin ? t.auth.loginKicker : t.auth.registerKicker}
          </Txt>
          <Txt variant="display" style={{ fontSize: 46, lineHeight: 48 }}>
            {isLogin ? t.auth.loginTitle : t.auth.registerTitle}
          </Txt>
          <Txt variant="body" style={{ color: colors.warmGray, marginTop: 12, fontSize: 15, lineHeight: 22 }}>
            {isLogin ? t.auth.loginBody : t.auth.registerBody}
          </Txt>
        </View>

        <View style={{ marginTop: 36, gap: 22 }}>
          <Field
            label={t.auth.email}
            error={errors.email}
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              setServerError(null);
            }}
            placeholder={t.auth.emailPlaceholder}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            // "username" pairs the email with the password for iOS Keychain autofill.
            textContentType="username"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
            editable={!busy}
          />
          <Field
            ref={passwordRef}
            label={t.auth.password}
            error={errors.password}
            hint={isLogin ? undefined : t.auth.passwordHint}
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              setServerError(null);
            }}
            placeholder={t.auth.passwordPlaceholder}
            secureTextEntry={!reveal}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            textContentType={isLogin ? 'password' : 'newPassword'}
            passwordRules={isLogin ? undefined : `minlength: ${PASSWORD_MIN_LENGTH}; maxlength: ${PASSWORD_MAX_LENGTH};`}
            maxLength={PASSWORD_MAX_LENGTH}
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            editable={!busy}
            accessory={
              <Pressable onPress={() => setReveal((v) => !v)} hitSlop={10} accessibilityRole="button">
                <Txt variant="caption" style={{ color: colors.charcoal, fontFamily: fonts.sansSemi }}>
                  {reveal ? t.auth.hide : t.auth.show}
                </Txt>
              </Pressable>
            }
          />
        </View>

        {serverError ? (
          <View style={{ marginTop: 20 }}>
            <Banner tone="warning" text={serverError} />
          </View>
        ) : null}

        <View style={{ flex: 1, minHeight: 32 }} />

        {isLogin && hasLocalPieces ? (
          <Txt variant="caption" style={{ marginBottom: 14, textAlign: 'center' }}>
            {t.auth.mergeNote}
          </Txt>
        ) : null}
        <Button title={isLogin ? t.auth.submitLogin : t.auth.submitRegister} size="lg" loading={busy} onPress={() => void submit()} />
        <Pressable onPress={switchMode} disabled={busy} style={styles.switch} accessibilityRole="button">
          <Txt variant="caption">{isLogin ? t.auth.noAccount : t.auth.haveAccount}</Txt>
          <Txt variant="caption" style={{ color: colors.charcoal, fontFamily: fonts.sansSemi }}>
            {isLogin ? t.auth.toRegister : t.auth.toLogin}
          </Txt>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function Field({
  label,
  error,
  hint,
  accessory,
  ref,
  ...input
}: TextInputProps & { label: string; error?: string; hint?: string; accessory?: React.ReactNode; ref?: React.Ref<TextInput> }) {
  return (
    <View>
      <Txt variant="label" style={{ fontSize: 10, marginBottom: 6 }}>
        {label}
      </Txt>
      <View style={[styles.field, error ? { borderBottomColor: colors.danger } : null]}>
        <TextInput ref={ref} placeholderTextColor={colors.mutedGray} style={styles.input} {...input} />
        {accessory}
      </View>
      {error ? (
        <Txt variant="caption" style={{ color: colors.danger, marginTop: 6 }} accessibilityLiveRegion="polite">
          {error}
        </Txt>
      ) : hint ? (
        <Txt variant="caption" style={{ marginTop: 6 }}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  input: { flex: 1, fontFamily: fonts.sans, fontSize: 17, color: colors.charcoal, paddingVertical: 10 },
  switch: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 16 },
});
