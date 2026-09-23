import { useMemo, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import Constants from 'expo-constants';
import { ArrowUpRight, Camera, ChevronRight, Crown, LogOut, Plus, RotateCcw, Trash2 } from 'lucide-react-native';
import { GARMENT_CATEGORIES, PLANS, labelFor, type GarmentRow, type PlanId } from '@mirobe/shared';
import { NotificationSettingsCard, ToggleRow } from '@/components/Notifications';
import { Screen } from '@/components/Screen';
import { Button, Chip, SectionHeader, Txt, haptic } from '@/components/ui';
import { mediaUrl } from '@/lib/api';
import { billingAvailable, PRIVACY_URL, restore } from '@/lib/billing';
import { ensureAiConsent, openWithAccount, selectActiveAvatar, setAiConsent, setLang, signOut, syncNow, useStore, useStrings } from '@/lib/store';
import { colors, fonts, radius } from '@/lib/theme';

/** Style tags and colours weighted across the wardrobe, most frequent first. */
function styleProfile(garments: GarmentRow[]) {
  const styles = new Map<string, number>();
  const palette = new Map<string, { hex: string; count: number }>();
  for (const garment of garments) {
    for (const tag of garment.styleTags) styles.set(tag, (styles.get(tag) ?? 0) + 1);
    garment.colors.forEach((color, index) => {
      const entry = palette.get(color.name) ?? { hex: color.hex, count: 0 };
      entry.count += index === 0 ? 2 : 1; // the dominant colour counts double
      palette.set(color.name, entry);
    });
  }
  const topStyles = [...styles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const total = topStyles.reduce((sum, [, count]) => sum + count, 0) || 1;
  return {
    styles: topStyles.map(([tag, count]) => ({ tag, share: count / total })),
    palette: [...palette.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6)
      .map(([name, { hex }]) => ({ name, hex })),
  };
}

const NEXT_PLAN: Record<PlanId, PlanId | null> = { free: 'plus', plus: 'pro', pro: null };

export default function Profile() {
  const t = useStrings();
  const lang = useStore((s) => s.lang);
  const usage = useStore((s) => s.usage);
  const garments = useStore((s) => s.garments);
  const looks = useStore((s) => s.looks);
  const avatar = useStore(selectActiveAvatar);
  const syncing = useStore((s) => s.syncing);
  const planId = usage?.planId ?? 'free';
  const nextPlan = NEXT_PLAN[planId];
  const signedIn = useStore((s) => !s.isAnonymous);

  const ready = useMemo(() => garments.filter((g) => g.taggingStatus === 'ready'), [garments]);
  const profile = useMemo(() => styleProfile(ready), [ready]);
  const counts = useMemo(
    () => GARMENT_CATEGORIES.map((category) => ({ category, count: ready.filter((g) => g.category === category).length })),
    [ready]
  );
  const maxCount = Math.max(1, ...counts.map((c) => c.count));
  const missing = counts.filter((c) => c.count === 0 && c.category !== 'dress' && c.category !== 'accessory');

  return (
    <Screen onRefresh={() => void syncNow()} refreshing={syncing}>
      <Txt variant="title">{t.profile.title}</Txt>

      <AccountCard />

      {/* Mirror photo */}
      <Pressable onPress={() => openWithAccount('/avatar')} style={({ pressed }) => [styles.mirrorCard, { transform: [{ scale: pressed ? 0.99 : 1 }] }]}>
        <View style={styles.mirrorPhoto}>
          {avatar ? (
            <Image source={{ uri: mediaUrl(avatar.imageUrl) }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" transition={200} />
          ) : (
            <Camera size={24} color={colors.warmGray} />
          )}
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Txt variant="label" style={{ fontSize: 10 }}>
            {t.profile.avatar}
          </Txt>
          <Txt style={{ fontFamily: fonts.serif, fontSize: 22, lineHeight: 26 }}>{avatar ? t.profile.avatarReady : t.home.createAvatar}</Txt>
          <Txt variant="caption">{t.profile.avatarHint}</Txt>
          <View style={styles.inlineLink}>
            <Txt style={{ fontFamily: fonts.sansSemi, fontSize: 12 }}>{avatar ? t.profile.changeAvatar : t.common.continue}</Txt>
            <ChevronRight size={14} color={colors.charcoal} />
          </View>
        </View>
      </Pressable>

      {/* Stats */}
      <View style={styles.stats}>
        <Stat value={garments.length} label={t.profile.statPieces} onPress={() => router.push('/wardrobe')} />
        <Stat value={looks.length} label={t.profile.statLooks} onPress={() => router.push('/looks')} />
        <Stat value={garments.filter((g) => g.favorite).length} label={t.profile.statFavorites} />
      </View>

      {/* Style identity */}
      <View style={{ marginTop: 28 }}>
        <SectionHeader title={t.profile.styleTitle} />
        {profile.styles.length === 0 ? (
          <View style={styles.card}>
            <Txt variant="caption">{t.profile.styleEmpty}</Txt>
          </View>
        ) : (
          <View style={styles.card}>
            <Txt style={{ fontFamily: fonts.serif, fontSize: 26, lineHeight: 30 }}>{profile.styles.map((s) => labelFor(s.tag, lang)).join(' · ')}</Txt>
            <View style={{ gap: 10, marginTop: 16 }}>
              {profile.styles.map((s) => (
                <View key={s.tag} style={{ gap: 5 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Txt variant="caption" style={{ color: colors.charcoal }}>
                      {labelFor(s.tag, lang)}
                    </Txt>
                    <Txt variant="caption">%{Math.round(s.share * 100)}</Txt>
                  </View>
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${s.share * 100}%` }]} />
                  </View>
                </View>
              ))}
            </View>
            {profile.palette.length ? (
              <>
                <Txt variant="label" style={{ fontSize: 10, marginTop: 20, marginBottom: 10 }}>
                  {t.profile.palette}
                </Txt>
                <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                  {profile.palette.map((color) => (
                    <View key={color.name} style={{ alignItems: 'center', gap: 4, width: 48 }}>
                      <View style={[styles.swatch, { backgroundColor: color.hex }]} />
                      <Txt variant="tiny" numberOfLines={1}>
                        {color.name}
                      </Txt>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </View>
        )}
      </View>

      {/* Wardrobe balance */}
      <View style={{ marginTop: 28 }}>
        <SectionHeader title={t.profile.balanceTitle} />
        <View style={styles.card}>
          {counts
            .filter((c) => c.count > 0)
            .map((c) => (
              <View key={c.category} style={styles.balanceRow}>
                <Txt variant="caption" style={{ width: 88, color: colors.charcoal }}>
                  {labelFor(c.category, lang)}
                </Txt>
                <View style={[styles.track, { flex: 1 }]}>
                  <View style={[styles.fill, { width: `${(c.count / maxCount) * 100}%` }]} />
                </View>
                <Txt variant="caption" style={{ width: 24, textAlign: 'right' }}>
                  {c.count}
                </Txt>
              </View>
            ))}
          {missing.length ? (
            <Pressable
              onPress={() => {
                void haptic('medium');
                openWithAccount('/scan');
              }}
              style={styles.missing}
            >
              <Plus size={14} color={colors.charcoal} />
              <Txt variant="caption" style={{ flex: 1, color: colors.charcoal }}>
                {t.profile.missing(missing.map((c) => labelFor(c.category, lang).toLocaleLowerCase(lang)).join(', '))}
              </Txt>
              <ChevronRight size={14} color={colors.charcoal} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Membership */}
      <View style={{ marginTop: 28 }}>
        <SectionHeader title={t.profile.plan} />
        <View style={[styles.card, planId === 'pro' && { backgroundColor: colors.charcoal, borderColor: colors.charcoal }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {planId !== 'free' ? <Crown size={18} color={colors.amber} /> : null}
              <Txt style={{ fontFamily: fonts.serif, fontSize: 28, lineHeight: 34, color: planId === 'pro' ? colors.ivory : colors.charcoal }}>
                {PLANS[planId].label}
              </Txt>
            </View>
            {planId === 'pro' ? (
              <View style={styles.topBadge}>
                <Txt style={{ fontSize: 10, fontFamily: fonts.sansSemi, color: '#171411' }}>{t.profile.topPlan}</Txt>
              </View>
            ) : null}
          </View>
          {usage ? (
            <View style={{ gap: 12, marginTop: 14 }}>
              <Meter dark={planId === 'pro'} label={t.profile.images} used={usage.images.used} limit={usage.images.limit} />
              {/* A plan without videos gets no empty (0 / 0) video meter. */}
              {usage.videos.limit > 0 ? <Meter dark={planId === 'pro'} label={t.profile.videos} used={usage.videos.used} limit={usage.videos.limit} /> : null}
              <Meter dark={planId === 'pro'} label={t.profile.jev} used={usage.stylist.used} limit={usage.stylist.limit} />
              <Meter dark={planId === 'pro'} label={t.profile.taggings} used={usage.taggings.used} limit={usage.taggings.limit} />
            </View>
          ) : null}
          {nextPlan ? (
            <Pressable onPress={() => router.push('/paywall')} style={styles.upgrade}>
              <Crown size={14} color={colors.amber} />
              <Txt style={{ color: colors.ivory, fontFamily: fonts.sansSemi, fontSize: 13 }}>{t.profile.upgradeTo(PLANS[nextPlan].label)}</Txt>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Daily reminder and payment notices: both belong to a signed-in account. */}
      {signedIn ? <NotificationSettingsCard /> : null}

      <PrivacyCard />

      {/* Settings */}
      <View style={{ marginTop: 28 }}>
        <SectionHeader title={t.profile.settings} />
        <View style={[styles.card, { paddingVertical: 4 }]}>
          <View style={styles.settingRow}>
            <Txt variant="body">{t.profile.language}</Txt>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Chip small label="Türkçe" active={lang === 'tr'} onPress={() => setLang('tr')} />
              <Chip small label="English" active={lang === 'en'} onPress={() => setLang('en')} />
            </View>
          </View>
          {billingAvailable ? (
            <Pressable onPress={() => void restore()} style={[styles.settingRow, styles.settingDivider]}>
              <Txt variant="body">{t.profile.restore}</Txt>
              <RotateCcw size={16} color={colors.warmGray} />
            </Pressable>
          ) : null}
          <View style={[styles.settingRow, styles.settingDivider]}>
            <Txt variant="body">{t.profile.version}</Txt>
            <Txt variant="caption">{Constants.expoConfig?.version ?? '1.0.0'}</Txt>
          </View>
        </View>
      </View>
    </Screen>
  );
}

/** Signed-in email with sign out, or the way in for an anonymous device. */
function AccountCard() {
  const t = useStrings();
  const email = useStore((s) => s.email);
  const [leaving, setLeaving] = useState(false);

  const confirmSignOut = () =>
    Alert.alert(t.profile.signOutTitle, t.profile.signOutBody, [
      { text: t.common.cancel, style: 'cancel' },
      {
        text: t.profile.signOut,
        style: 'destructive',
        onPress: () => {
          setLeaving(true);
          void signOut().finally(() => setLeaving(false));
        },
      },
    ]);

  if (!email) {
    return (
      <View style={[styles.card, { marginTop: 16 }]}>
        <Txt variant="label" style={{ fontSize: 10 }}>
          {t.profile.account}
        </Txt>
        <Txt style={{ fontFamily: fonts.serif, fontSize: 24, lineHeight: 28, marginTop: 6 }}>{t.profile.anonymousTitle}</Txt>
        <Txt variant="caption" style={{ marginTop: 6 }}>
          {t.profile.anonymousBody}
        </Txt>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
          <Button title={t.profile.signIn} style={{ flex: 1 }} onPress={() => router.push('/login')} />
          <Button title={t.profile.register} tone="ghost" style={{ flex: 1 }} onPress={() => router.push('/register')} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ marginTop: 16 }}>
      <View style={[styles.card, styles.accountRow]}>
        <View style={{ flex: 1, gap: 4 }}>
          <Txt variant="label" style={{ fontSize: 10 }}>
            {t.profile.signedInAs}
          </Txt>
          <Txt variant="bodyStrong" numberOfLines={1} ellipsizeMode="middle">
            {email}
          </Txt>
        </View>
        <Button title={t.profile.signOut} tone="ghost" size="sm" loading={leaving} icon={<LogOut size={14} color={colors.charcoal} />} onPress={confirmSignOut} />
      </View>
      <Pressable
        onPress={() => router.push('/delete-account')}
        disabled={leaving}
        accessibilityRole="button"
        hitSlop={6}
        style={({ pressed }) => [styles.deleteLink, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Trash2 size={13} color={colors.danger} />
        <Txt variant="caption" style={{ color: colors.danger, fontFamily: fonts.sansMedium }}>
          {t.profile.deleteAccount}
        </Txt>
      </Pressable>
    </View>
  );
}

/**
 * Consent to AI processing (a signed-in account's switch: withdraw it, or give it again through
 * the same sheet as the first AI action) and the privacy policy.
 */
function PrivacyCard() {
  const t = useStrings();
  const lang = useStore((s) => s.lang);
  const signedIn = useStore((s) => !s.isAnonymous);
  const aiConsent = useStore((s) => s.aiConsent);
  const [busy, setBusy] = useState(false);

  const change = async (allow: boolean) => {
    setBusy(true);
    try {
      if (allow) await ensureAiConsent();
      else await setAiConsent(false);
    } catch {
      Alert.alert(t.consent.setting, t.consent.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ marginTop: 28 }}>
      <SectionHeader title={t.profile.privacy} />
      <View style={[styles.card, { paddingVertical: 4 }]}>
        {signedIn ? (
          <ToggleRow label={t.consent.setting} hint={t.consent.settingHint} value={aiConsent} disabled={busy} onChange={(value) => void change(value)} />
        ) : null}
        <Pressable
          onPress={() => void Linking.openURL(`${PRIVACY_URL}?lang=${lang}`)}
          accessibilityRole="link"
          style={[styles.settingRow, signedIn && styles.settingDivider]}
        >
          <Txt variant="body">{t.paywall.privacy}</Txt>
          <ArrowUpRight size={16} color={colors.warmGray} />
        </Pressable>
      </View>
    </View>
  );
}

function Stat({ value, label, onPress }: { value: number; label: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.stat, { transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
      <Txt style={{ fontFamily: fonts.serif, fontSize: 32, lineHeight: 36 }}>{value}</Txt>
      <Txt variant="tiny" style={{ letterSpacing: 1, textTransform: 'uppercase' }}>
        {label}
      </Txt>
    </Pressable>
  );
}

function Meter({ label, used, limit, dark }: { label: string; used: number; limit: number; dark?: boolean }) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 1;
  const text = dark ? 'rgba(251,249,245,0.85)' : colors.charcoal;
  return (
    <View style={{ gap: 5 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Txt variant="caption" style={{ color: text }}>
          {label}
        </Txt>
        <Txt variant="caption" style={{ color: dark ? 'rgba(251,249,245,0.6)' : colors.warmGray, fontVariant: ['tabular-nums'] }}>
          {used} / {limit}
        </Txt>
      </View>
      <View style={[styles.track, dark && { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
        <View style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: ratio > 0.9 ? colors.danger : dark ? colors.amber : colors.charcoal }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: radius.lg, backgroundColor: colors.stone, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  mirrorCard: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 16,
    padding: 14,
    borderRadius: radius.xl,
    backgroundColor: colors.stone,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  mirrorPhoto: {
    width: 104,
    height: 138,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.stoneCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineLink: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 'auto' },
  stats: { flexDirection: 'row', gap: 10, marginTop: 12 },
  stat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.ivory,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  track: { height: 5, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3, backgroundColor: colors.charcoal },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.15)' },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  missing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.mutedGray,
  },
  topBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.amber },
  upgrade: {
    marginTop: 16,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.charcoal,
  },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  deleteLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', paddingHorizontal: 4, paddingTop: 10 },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  settingDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
