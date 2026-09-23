import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { PurchasesPackage } from 'react-native-purchases';
import { Check, Crown, Gift, X } from 'lucide-react-native';
import { PLANS } from '@mirobe/shared';
import { Banner, Button, Chip, IconButton, Txt } from '@/components/ui';
import {
  billingAvailable,
  billingErrorKind,
  currentSubscription,
  fallbackAmount,
  fallbackMonthlyEquivalent,
  fallbackPrice,
  loadPackages,
  manageSubscription,
  PRIVACY_URL,
  purchase,
  restore,
  TERMS_OF_USE_URL,
  type BillingErrorKind,
  type BillingPeriod,
  type PaidPlanId,
  type StorePackages,
  type StoreSubscription,
} from '@/lib/billing';
import { requireAccount, useStore, useStrings } from '@/lib/store';
import { colors, fonts, radius } from '@/lib/theme';

const PAID: PaidPlanId[] = ['plus', 'pro'];
const STORE_NAME = Platform.OS === 'ios' ? 'App Store' : 'Google Play';
const OTHER_STORE_NAME = Platform.OS === 'ios' ? 'Google Play' : 'App Store';

/**
 * Annual discount against twelve monthly payments. Both prices come from one source: the store when both
 * packages are loaded in the same currency, the static table otherwise. Mixing a store price with a fallback
 * compared USD with TRY and advertised "Save 98%".
 */
function planPrices(plan: PaidPlanId, packages: StorePackages | null): { monthly: number; annual: number } {
  const store = packages?.[plan];
  const fromStore = store?.monthly && store.annual && store.monthly.product.currencyCode === store.annual.product.currencyCode;
  return {
    monthly: fromStore ? store.monthly!.product.price : fallbackAmount(plan, 'monthly').amount,
    annual: fromStore ? store.annual!.product.price : fallbackAmount(plan, 'annual').amount,
  };
}

function annualSavings(plan: PaidPlanId, packages: StorePackages | null): number {
  const { monthly, annual } = planPrices(plan, packages);
  return monthly > 0 ? Math.round((1 - annual / (monthly * 12)) * 100) : 0;
}

/** Whole months the annual price saves against paying monthly; never rounded up past what the prices give. */
function freeMonths(plan: PaidPlanId, packages: StorePackages | null): number {
  const { monthly, annual } = planPrices(plan, packages);
  return monthly > 0 ? Math.max(0, Math.floor(12 - annual / monthly + 0.05)) : 0;
}

type Notice = { tone: 'neutral' | 'warning'; text: string };

export default function Paywall() {
  const t = useStrings();
  const current = useStore((s) => s.usage?.planId ?? 'free');
  const isAnonymous = useStore((s) => s.isAnonymous);
  const [packages, setPackages] = useState<StorePackages | null>(billingAvailable ? null : {});
  const [loadError, setLoadError] = useState<BillingErrorKind | null>(null);
  const [subscription, setSubscription] = useState<StoreSubscription | null>(null);
  const [period, setPeriod] = useState<BillingPeriod>('monthly');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const userId = useStore((s) => s.userId);
  const { manage } = useLocalSearchParams<{ manage?: string }>();
  const managed = useRef(false);

  // Opened from a "payment failed" notification: straight into the store's subscription
  // management, where the payment method is fixed. Once, after the session (and RevenueCat) is up.
  useEffect(() => {
    if (manage !== '1' || managed.current || !billingAvailable || !userId) return;
    const timer = setTimeout(() => {
      managed.current = true;
      void manageSubscription().catch(() => undefined);
    }, 700);
    return () => clearTimeout(timer);
  }, [manage, userId]);

  useEffect(() => {
    if (!billingAvailable) return;
    loadPackages()
      .then(setPackages)
      .catch((error) => {
        const kind = billingErrorKind(error);
        setLoadError(kind === 'cancelled' || kind === 'pending' ? 'unknown' : kind);
        setPackages({});
      });
  }, []);

  // Re-read after sign-in (the screen stays mounted under the login modal) and after purchases.
  const reloadSubscription = useCallback(() => {
    if (billingAvailable && !isAnonymous) void currentSubscription().then(setSubscription).catch(() => undefined);
  }, [isAnonymous]);
  useEffect(reloadSubscription, [reloadSubscription, current]);

  const errorText = (kind: BillingErrorKind) => t.paywall.errors[kind];

  const buy = async (pkg: PurchasesPackage, plan: PaidPlanId) => {
    setBusy(pkg.identifier);
    setNotice(null);
    try {
      const result = await purchase(pkg);
      switch (result.status) {
        case 'purchased':
          reloadSubscription();
          if (result.deferred) setNotice({ tone: 'neutral', text: t.paywall.deferred });
          else if (result.plan === plan) {
            setNotice({ tone: 'neutral', text: t.paywall.purchased(PLANS[plan].label) });
            router.back();
          } else setNotice({ tone: 'neutral', text: t.paywall.purchasedPending });
          break;
        case 'pending':
          setNotice({ tone: 'neutral', text: t.paywall.pending });
          break;
        case 'error':
          setNotice({ tone: 'warning', text: errorText(result.error) });
          break;
        // cancelled: the user closed the sheet, nothing to say. needs_account: the login screen is open.
      }
    } finally {
      setBusy(null);
    }
  };

  const onRestore = async () => {
    setBusy('restore');
    setNotice(null);
    try {
      const result = await restore();
      if (result.status === 'restored') {
        setNotice({ tone: 'neutral', text: t.paywall.restored });
        reloadSubscription();
      } else if (result.status === 'nothing') setNotice({ tone: 'neutral', text: t.paywall.nothingToRestore });
      else if (result.status === 'error') setNotice({ tone: 'warning', text: errorText(result.error) });
    } finally {
      setBusy(null);
    }
  };

  const savings = Math.max(...PAID.map((id) => annualSavings(id, packages)));
  const otherStore = subscription !== null && !subscription.thisStore;
  const canBuy = billingAvailable && packages !== null && !isAnonymous && !otherStore;
  const hasPaidPlan = current !== 'free' || subscription !== null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.ivory }} contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 48 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Txt variant="title">{t.paywall.title}</Txt>
          <Txt variant="caption" style={{ marginTop: 4 }}>
            {t.paywall.body}
          </Txt>
        </View>
        <IconButton accessibilityLabel={t.common.close} tone="stone" onPress={() => router.back()}>
          <X size={18} color={colors.charcoal} />
        </IconButton>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Chip label={t.paywall.monthly} active={period === 'monthly'} onPress={() => setPeriod('monthly')} />
        <Chip label={t.paywall.annual} active={period === 'annual'} onPress={() => setPeriod('annual')} />
        {savings > 0 ? (
          <Txt variant="caption" style={{ color: colors.charcoal, fontFamily: fonts.sansSemi }}>
            {t.paywall.save(savings)}
          </Txt>
        ) : null}
      </View>

      {current === 'free' ? <Txt variant="caption">{t.paywall.currentFree(PLANS.free.images, PLANS.free.stylist, PLANS.free.taggings)}</Txt> : null}

      {PAID.map((id) => {
        const plan = PLANS[id];
        const pkg = packages?.[id]?.[period];
        const price = pkg?.product.priceString ?? fallbackPrice(id, period);
        const dark = id === 'pro';
        const text = dark ? colors.ivory : colors.charcoal;
        const muted = dark ? colors.stone : colors.warmGray;
        // The exact package owned (plan + period) when the store tells us; otherwise the server's plan.
        const owned = subscription ? subscription.plan === id && subscription.period === period : current === id;
        // Plan rights are monthly counts, on the annual plan too.
        const bullets: { label: string; note?: string }[] = [
          { label: t.paywall.images(plan.images), note: t.paywall.imagesNote },
          ...(plan.videos > 0 ? [{ label: t.paywall.videos(plan.videos) }] : []),
          { label: t.paywall.jev(plan.stylist) },
          { label: t.paywall.taggings(plan.taggings) },
        ];
        // The billed yearly price stays the prominent one (App Store 3.1.2); the monthly equivalent is secondary.
        const monthlyEquivalent =
          period === 'annual' ? (pkg?.product.pricePerMonthString ?? (pkg ? null : fallbackMonthlyEquivalent(id))) : null;
        const monthsFree = period === 'annual' ? freeMonths(id, packages) : 0;
        return (
          <View
            key={id}
            style={[styles.plan, dark && { backgroundColor: colors.charcoal, borderColor: colors.charcoal }, current === id && { borderColor: colors.amber, borderWidth: 1.5 }]}
          >
            {monthsFree > 0 ? (
              <View style={styles.sticker} accessibilityRole="text">
                <Gift size={13} color={colors.charcoal} />
                <Txt style={styles.stickerText}>{t.paywall.monthsFree(monthsFree)}</Txt>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Crown size={18} color={colors.amber} />
                <Txt style={{ fontFamily: fonts.serif, fontSize: 28, lineHeight: 34, color: text }}>{plan.label}</Txt>
              </View>
              {current === id ? (
                <View style={styles.badge}>
                  <Txt style={{ fontSize: 10, fontFamily: fonts.sansSemi, color: '#171411' }}>{t.paywall.current}</Txt>
                </View>
              ) : null}
            </View>
            <Txt variant="bodyStrong" style={{ marginTop: 4, color: text }}>
              {`${price} ${period === 'annual' ? t.paywall.perYear : t.paywall.perMonth}`}
              {monthlyEquivalent ? (
                <Txt variant="caption" style={{ color: muted }}>{`  ·  ${t.paywall.perMonthEquivalent(monthlyEquivalent)}`}</Txt>
              ) : null}
            </Txt>
            <View style={{ gap: 6, marginTop: 12 }}>
              {bullets.map(({ label, note }) => (
                <View key={label}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Check size={14} color={dark ? colors.amber : colors.charcoal} />
                    <Txt variant="caption" style={{ color: muted }}>
                      {label}
                    </Txt>
                  </View>
                  {note ? (
                    <Txt variant="tiny" style={{ color: muted, marginLeft: 22, marginTop: 2 }}>
                      {note}
                    </Txt>
                  ) : null}
                </View>
              ))}
            </View>
            {owned ? (
              <Txt variant="caption" style={{ marginTop: 12, color: muted, fontFamily: fonts.sansSemi }}>
                {t.paywall.currentPackage}
              </Txt>
            ) : canBuy ? (
              pkg ? (
                <>
                  <Button
                    style={{ marginTop: 14 }}
                    tone={dark ? 'gold' : 'primary'}
                    title={hasPaidPlan ? t.paywall.change(plan.label) : t.paywall.subscribe(plan.label, period)}
                    loading={busy === pkg.identifier}
                    disabled={busy !== null}
                    onPress={() => void buy(pkg, id)}
                  />
                  <Txt variant="caption" style={{ marginTop: 6, color: muted, textAlign: 'center' }}>
                    {t.paywall.autoRenew(price, period)}
                  </Txt>
                </>
              ) : (
                <Txt variant="caption" style={{ marginTop: 12, color: muted }}>
                  {t.paywall.unavailable}
                </Txt>
              )
            ) : null}
          </View>
        );
      })}

      {billingAvailable && isAnonymous ? (
        <View style={{ gap: 8 }}>
          <Button title={t.paywall.signInToBuy} onPress={() => requireAccount('/paywall')} />
          <Txt variant="caption" style={{ textAlign: 'center' }}>
            {t.paywall.signInHint}
          </Txt>
        </View>
      ) : null}

      {!billingAvailable ? <Banner text={t.paywall.notConfigured} /> : null}
      {billingAvailable && packages === null ? <ActivityIndicator color={colors.warmGray} /> : null}
      {loadError ? <Banner tone="warning" text={errorText(loadError)} /> : null}
      {otherStore ? <Banner text={t.paywall.otherStore(OTHER_STORE_NAME)} /> : null}
      {notice ? <Banner tone={notice.tone} text={notice.text} /> : null}

      {billingAvailable ? (
        <View style={{ gap: 4 }}>
          <Button title={t.paywall.restore} tone="ghost" loading={busy === 'restore'} disabled={busy !== null} onPress={() => void onRestore()} />
          {hasPaidPlan && !isAnonymous && !otherStore ? (
            <Button title={t.paywall.manage} tone="ghost" disabled={busy !== null} onPress={() => void manageSubscription().catch(() => undefined)} />
          ) : null}
        </View>
      ) : null}

      <View style={{ gap: 10 }}>
        <Txt variant="caption" style={{ fontSize: 11, lineHeight: 16 }}>
          {t.paywall.legal(STORE_NAME)}
        </Txt>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16 }}>
          <Txt variant="caption" style={styles.link} accessibilityRole="link" onPress={() => void Linking.openURL(TERMS_OF_USE_URL)}>
            {t.paywall.terms}
          </Txt>
          <Txt variant="caption" style={styles.link} accessibilityRole="link" onPress={() => void Linking.openURL(PRIVACY_URL)}>
            {t.paywall.privacy}
          </Txt>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  plan: { padding: 16, borderRadius: radius.lg, backgroundColor: colors.stone, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.amber },
  // The annual saving, stuck on the card's corner: it overlaps the edge so it never crowds the "current plan" badge.
  sticker: {
    position: 'absolute',
    top: -13,
    right: 14,
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.amber,
    transform: [{ rotate: '-3deg' }],
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  stickerText: { fontSize: 12, lineHeight: 15, fontFamily: fonts.sansSemi, color: colors.charcoal },
  link: { color: colors.charcoal, fontFamily: fonts.sansSemi, textDecorationLine: 'underline' },
});
