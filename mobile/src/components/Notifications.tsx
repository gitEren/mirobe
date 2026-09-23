import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Alert, Animated, AppState, Easing, Linking, Modal, Pressable, StyleSheet, Switch, View } from 'react-native';
import { useRootNavigationState, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bell, CreditCard, RefreshCw, Sparkles } from 'lucide-react-native';
import { PLANS, type UserNotice } from '@mirobe/shared';
import { Button, SectionHeader, Txt } from '@/components/ui';
import {
  loadNotificationSettings,
  noteSoftAskShown,
  notificationsAvailable,
  notificationsNavigationReady,
  refreshPermission,
  registerDevice,
  reloadLocalPreferences,
  requestPermission,
  scheduleReminders,
  setDailyReminder,
  setSubscriptionNotices,
  softAskDue,
  startNotifications,
  useNotificationState,
} from '@/lib/notifications';
import { reminderGarments } from '@/lib/reminders';
import { noticeShown, useStore, useStrings } from '@/lib/store';
import { colors, fonts, radius } from '@/lib/theme';

/** A garment added, or a try-on finished, this recently makes a good moment to explain notifications. */
const FRESH_MS = 10 * 60 * 1000;
/** How long an in-app notice stays up, and how soon after launch the first may appear (the splash is gone by then). */
const NOTICE_MS = 5000;
const NOTICE_SETTLE_MS = 2500;

/**
 * Mounted once in the root layout. Renders nothing (and does nothing) in a build without
 * the expo-notifications native module.
 */
export function NotificationsHost() {
  return notificationsAvailable ? <Host /> : null;
}

function Host() {
  const userId = useStore((s) => s.userId);
  const lang = useStore((s) => s.lang);
  const signedIn = useStore((s) => !s.isAnonymous);
  const garments = useStore((s) => s.garments);
  const permission = useNotificationState((s) => s.permission);
  const ready = useNotificationState((s) => s.ready);
  const daily = useNotificationState((s) => s.daily);
  const navigationReady = Boolean(useRootNavigationState()?.key);

  useEffect(() => startNotifications(), []);

  useEffect(() => {
    if (navigationReady) notificationsNavigationReady();
  }, [navigationReady]);

  // A sign-out clears the device database and a new session starts: switches are read
  // again, the token is registered for whoever is signed in now, in the current language.
  useEffect(() => {
    reloadLocalPreferences();
  }, [userId]);
  useEffect(() => {
    if (permission === 'granted' && userId) void registerDevice();
  }, [permission, userId, lang]);
  useEffect(() => {
    if (userId && signedIn) void loadNotificationSettings();
  }, [userId, signedIn]);

  // Reminders mention garments by name: re-plan when those names (or the language) change.
  const wardrobeKey = useMemo(() => reminderGarments(garments, lang).join('|'), [garments, lang]);
  useEffect(() => {
    scheduleReminders();
  }, [wardrobeKey, lang, signedIn, ready, permission, daily]);

  // Back in the app: today is covered, the window moves on, and Settings may have changed the permission.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status !== 'active') return;
      void refreshPermission().then(() => scheduleReminders());
    });
    return () => subscription.remove();
  }, []);

  const [asking, closeAsk] = useSoftAskMoment();
  return <SoftAsk visible={asking} onClose={closeAsk} />;
}

/**
 * Offers the in-app explanation after the user did something worth being reminded of
 * (added a garment, finished a try-on), never at first launch or over a modal screen,
 * and only while the system prompt has not been answered.
 */
function useSoftAskMoment(): [boolean, () => void] {
  const [visible, setVisible] = useState(false);
  const segments = useSegments();
  const onTabs = segments[0] === '(tabs)';
  const signedIn = useStore((s) => !s.isAnonymous);
  const garments = useStore((s) => s.garments);
  const tryons = useStore((s) => s.tryons);
  const permission = useNotificationState((s) => s.permission);
  const ready = useNotificationState((s) => s.ready);
  const startedAt = useRef(Date.now());

  const lastAction = useMemo(() => {
    const times = [...garments.map((g) => g.createdAt), ...tryons.filter((t) => t.status === 'ready').map((t) => t.createdAt)].map((at) => Date.parse(at) || 0);
    return times.length ? Math.max(...times) : 0;
  }, [garments, tryons]);

  useEffect(() => {
    if (visible || !ready || !onTabs || !signedIn || permission !== 'undetermined' || Date.now() - lastAction > FRESH_MS || !softAskDue()) return;
    // Let the screen settle (and the launch splash finish) first.
    const wait = Math.max(1200, 4000 - (Date.now() - startedAt.current));
    const timer = setTimeout(() => {
      if (!softAskDue()) return;
      noteSoftAskShown();
      setVisible(true);
    }, wait);
    return () => clearTimeout(timer);
  }, [visible, ready, onTabs, signedIn, permission, lastAction]);

  return [visible, () => setVisible(false)];
}

function SoftAsk({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useStrings();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  const allow = async () => {
    setBusy(true);
    try {
      await requestPermission();
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : onClose} accessibilityLabel={t.notifications.later} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.bell}>
            <Bell size={20} color={colors.amber} />
          </View>
          <Txt variant="title" style={{ marginTop: 16 }}>
            {t.notifications.askTitle}
          </Txt>
          <Txt variant="body" style={{ color: colors.warmGray, marginTop: 8 }}>
            {t.notifications.askBody}
          </Txt>
          <View style={{ gap: 12, marginTop: 16 }}>
            <Reason icon={<Sparkles size={15} color={colors.amber} />} text={t.notifications.askDaily} />
            <Reason icon={<CreditCard size={15} color={colors.amber} />} text={t.notifications.askSubscription} />
          </View>
          <Txt variant="caption" style={{ marginTop: 16 }}>
            {t.notifications.askFoot}
          </Txt>
          <Button title={t.notifications.allow} size="lg" loading={busy} onPress={() => void allow()} style={{ marginTop: 20 }} />
          <Button title={t.notifications.later} tone="ghost" disabled={busy} onPress={onClose} style={{ marginTop: 10 }} />
        </View>
      </View>
    </Modal>
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

/**
 * Mounted once in the root layout, in every build: the notices the server leaves for the
 * app instead of a push (auto-renew switched back on, …), one at a time as a short banner
 * over the tabs. Each is marked seen as it appears; a tap puts it away early. Without
 * notices (an older server sends none) it renders nothing.
 */
export function InAppNotices() {
  const t = useStrings();
  const insets = useSafeAreaInsets();
  const userId = useStore((s) => s.userId);
  const next = useStore((s) => s.notices[0]);
  const onTabs = useSegments()[0] === '(tabs)';
  const [current, setCurrent] = useState<UserNotice | null>(null);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const opacity = useRef(new Animated.Value(0)).current;
  const startedAt = useRef(Date.now());

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => setActive(status === 'active'));
    return () => subscription.remove();
  }, []);

  // One at a time: after the launch splash, in the foreground and only over the tabs (a modal
  // screen would cover it), since a notice counts as seen once it is up.
  useEffect(() => {
    if (current || !next || !onTabs || !active) return;
    const wait = Math.max(600, NOTICE_SETTLE_MS - (Date.now() - startedAt.current));
    const timer = setTimeout(() => {
      setCurrent(next);
      noticeShown(next.id);
    }, wait);
    return () => clearTimeout(timer);
  }, [current, next, onTabs, active]);

  const hide = useCallback(() => {
    Animated.timing(opacity, { toValue: 0, duration: 200, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => setCurrent(null));
  }, [opacity]);

  useEffect(() => {
    if (!current) return;
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 240, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    const timer = setTimeout(hide, NOTICE_MS);
    return () => clearTimeout(timer);
  }, [current, hide, opacity]);

  // Signed out or into another account: whatever was showing belonged to the previous one.
  useEffect(() => {
    setCurrent(null);
  }, [userId]);

  const text = current ? t.notices[current.kind] : null;
  const title = text?.title ?? '';
  const body = current && text ? text.body(current.plan ? PLANS[current.plan].label : null) : '';

  useEffect(() => {
    if (title) AccessibilityInfo.announceForAccessibility(`${title}. ${body}`);
  }, [title, body]);

  if (!current) return null;
  return (
    <Animated.View pointerEvents="box-none" style={[styles.noticeWrap, { top: insets.top + 8, opacity }]}>
      <Pressable onPress={hide} accessibilityRole="alert" accessibilityLabel={`${title}. ${body}`} style={styles.notice}>
        <View style={styles.noticeIcon}>
          <RefreshCw size={16} color={colors.amber} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="bodyStrong" style={{ color: colors.ivory }}>
            {title}
          </Txt>
          <Txt variant="caption" style={{ color: 'rgba(251,249,245,0.72)' }}>
            {body}
          </Txt>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Profile → Notifications: the daily reminder and payment notices, each asking for
 * permission when turned on. Not shown in a build without the native module.
 */
export function NotificationSettingsCard() {
  return notificationsAvailable ? <SettingsCard /> : null;
}

function SettingsCard() {
  const t = useStrings();
  const permission = useNotificationState((s) => s.permission);
  const daily = useNotificationState((s) => s.daily);
  const subscription = useNotificationState((s) => s.subscription);
  const subscribed = useStore((s) => (s.usage?.planId ?? 'free') !== 'free');
  const [busy, setBusy] = useState(false);
  // Both switches are on by default: they read as on until the phone's permission is refused.
  // Before the permission is asked, the daily reminder waits for it (see the note below).
  const allowed = permission !== 'denied';
  const waiting = permission !== 'granted' && permission !== 'denied';

  const explainDenied = () =>
    Alert.alert(t.notifications.deniedTitle, t.notifications.deniedBody, [
      { text: t.common.cancel, style: 'cancel' },
      { text: t.notifications.openSettings, onPress: () => void Linking.openSettings() },
    ]);

  const change = async (apply: () => Promise<string>) => {
    setBusy(true);
    try {
      const result = await apply();
      if (result === 'denied') explainDenied();
      else if (result === 'failed') Alert.alert(t.notifications.title, t.notifications.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ marginTop: 28 }}>
      <SectionHeader title={t.notifications.title} />
      <View style={[styles.card, { paddingVertical: 4 }]}>
        <ToggleRow
          label={t.notifications.daily}
          hint={t.notifications.dailyHint}
          value={allowed && daily}
          disabled={busy}
          onChange={(value) => void change(() => setDailyReminder(value))}
        />
        {waiting && daily ? (
          <Pressable onPress={() => void change(() => setDailyReminder(true))} accessibilityRole="button" style={styles.note}>
            <Txt variant="caption">{t.notifications.waitingPermission}</Txt>
            <Txt variant="caption" style={{ color: colors.charcoal, fontFamily: fonts.sansSemi, marginTop: 2 }}>
              {t.notifications.allowNow}
            </Txt>
          </Pressable>
        ) : null}
        {/* Payment notices only concern subscribers: the switch appears with the subscription, already on. */}
        {subscribed ? (
          <ToggleRow
            divider
            label={t.notifications.subscription}
            hint={t.notifications.subscriptionHint}
            value={allowed && subscription !== false}
            disabled={busy}
            onChange={(value) => void change(() => setSubscriptionNotices(value))}
          />
        ) : null}
        {permission === 'denied' ? (
          <Pressable onPress={() => void Linking.openSettings()} accessibilityRole="button" style={styles.note}>
            <Txt variant="caption">{t.notifications.denied}</Txt>
            <Txt variant="caption" style={{ color: colors.charcoal, fontFamily: fonts.sansSemi, marginTop: 2 }}>
              {t.notifications.openSettings}
            </Txt>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** A labelled switch with a one-line hint (also used by Profile's privacy card). */
export function ToggleRow({
  label,
  hint,
  value,
  disabled,
  divider,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  disabled?: boolean;
  divider?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={[styles.row, divider && styles.divider]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="body">{label}</Txt>
        <Txt variant="caption">{hint}</Txt>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.charcoal }}
        thumbColor={colors.white}
        ios_backgroundColor={colors.border}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(26,25,24,0.4)' },
  sheet: {
    paddingHorizontal: 24,
    paddingTop: 24,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.ivory,
  },
  bell: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.charcoal, alignItems: 'center', justifyContent: 'center' },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  reasonIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.charcoal, alignItems: 'center', justifyContent: 'center' },
  card: { padding: 16, borderRadius: radius.lg, backgroundColor: colors.stone, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  note: { paddingTop: 10, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  noticeWrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  notice: {
    width: '100%',
    maxWidth: 480,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.charcoal,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  noticeIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.charcoalMuted, alignItems: 'center', justifyContent: 'center' },
});
