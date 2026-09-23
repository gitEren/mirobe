import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ArrowUpRight, Camera, Mic, Sparkles, UserRound } from 'lucide-react-native';
import { Wordmark } from '@/components/brand';
import { GarmentCard } from '@/components/garment';
import { labelFor } from '@mirobe/shared';
import { EmptyWardrobe, QuickOccasions } from '@/components/home';
import { OutfitCollage } from '@/components/look';
import { Screen } from '@/components/Screen';
import { Banner, SectionHeader, Txt, haptic } from '@/components/ui';
import { openWithAccount, selectActiveAvatar, syncNow, useStore, useStrings } from '@/lib/store';
import { colors, fonts, radius } from '@/lib/theme';

export default function Home() {
  const t = useStrings();
  const garments = useStore((s) => s.garments);
  const looks = useStore((s) => s.looks);
  const lang = useStore((s) => s.lang);
  const avatar = useStore(selectActiveAvatar);
  const online = useStore((s) => s.online);
  const syncing = useStore((s) => s.syncing);
  const lastError = useStore((s) => s.lastError);

  const latestLook = looks[0];

  return (
    <Screen onRefresh={() => void syncNow()} refreshing={syncing}>
      <View style={styles.header}>
        <Wordmark size={38} tagline={t.tagline} />
        <Pressable
          onPress={() => {
            void haptic('medium');
            openWithAccount('/scan');
          }}
          style={styles.scanPill}
        >
          <Camera size={14} color={colors.amber} />
          <Txt style={{ color: colors.ivory, fontFamily: fonts.sansSemi, fontSize: 12 }}>{t.home.scanTitle}</Txt>
        </Pressable>
      </View>

      {!online ? <Banner text={t.common.offline} /> : null}
      {lastError === 'PROVIDER_CREDITS' ? <Banner tone="warning" text={t.common.noCredits} /> : null}

      <Pressable
        onPress={() => {
          void haptic('medium');
          openWithAccount('/stylist');
        }}
        style={({ pressed }) => [styles.jevCard, { transform: [{ scale: pressed ? 0.99 : 1 }] }]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Sparkles size={16} color={colors.gold} />
            <Txt style={{ color: colors.ivory, fontFamily: fonts.sansSemi, fontSize: 13, letterSpacing: 0.4 }}>{t.home.askJev}</Txt>
          </View>
          <View style={styles.micBubble}>
            <Mic size={15} color={colors.charcoal} />
          </View>
        </View>
        <Txt style={{ color: colors.ivory, fontFamily: fonts.serif, fontSize: 26, lineHeight: 30, marginTop: 14 }}>{t.home.greeting}</Txt>
        <Txt style={{ color: 'rgba(251,249,245,0.6)', fontSize: 12, marginTop: 6 }}>{t.home.askJevHint}</Txt>
      </Pressable>

      <View style={styles.actionRow}>
        <ActionCard
          title={t.home.scanTitle}
          body={t.home.scanDesc}
          icon={<Camera size={16} color={colors.amber} />}
          onPress={() => openWithAccount('/scan')}
        />
        <ActionCard
          dark
          title={t.home.mirrorTitle}
          body={t.home.mirrorDesc}
          icon={<Sparkles size={16} color={colors.amber} />}
          onPress={() => openWithAccount(avatar ? '/mirror' : '/avatar')}
        />
      </View>

      {!avatar ? (
        <Pressable onPress={() => openWithAccount('/avatar')} style={styles.avatarPrompt}>
          <View style={styles.avatarIcon}>
            <UserRound size={18} color={colors.charcoal} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="bodyStrong">{t.home.createAvatar}</Txt>
            <Txt variant="caption">{t.home.createAvatarDesc}</Txt>
          </View>
          <ArrowUpRight size={16} color={colors.charcoal} />
        </Pressable>
      ) : null}

      {latestLook ? (
        <View style={{ marginTop: 28 }}>
          <SectionHeader title={t.home.latestLook} action={t.common.seeAll} onAction={() => router.push('/looks')} />
          <Pressable
            onPress={() => router.push({ pathname: '/look/[id]', params: { id: latestLook.id } })}
            style={({ pressed }) => [styles.hero, { transform: [{ scale: pressed ? 0.99 : 1 }] }]}
          >
            {/* The outfit's own pieces as a flat-lay; AI try-on photos live in the Looks tab. */}
            <View style={styles.heroCollage}>
              <OutfitCollage garmentIds={latestLook.garmentIds} />
            </View>
            <View style={styles.heroText}>
              <View style={{ flex: 1 }}>
                <Txt variant="label" style={{ fontSize: 10 }}>
                  {latestLook.occasion ? labelFor(latestLook.occasion, lang) : t.common.pieces(latestLook.garmentIds.length)}
                </Txt>
                <Txt style={{ fontFamily: fonts.serif, fontSize: 26, lineHeight: 30, marginTop: 2 }} numberOfLines={1}>
                  {latestLook.title}
                </Txt>
              </View>
              <View style={styles.heroCta}>
                <Sparkles size={13} color={colors.amber} />
                <Txt style={{ color: colors.ivory, fontFamily: fonts.sansSemi, fontSize: 12 }}>{t.looks.tryOn}</Txt>
              </View>
            </View>
          </Pressable>
        </View>
      ) : null}

      <View style={{ marginTop: 28 }}>
        {garments.length === 0 ? (
          <EmptyWardrobe />
        ) : (
          <>
            <SectionHeader title={t.home.recentlyAdded} action={t.tabs.wardrobe} onAction={() => router.push('/wardrobe')} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}>
              {garments.slice(0, 10).map((garment) => (
                <GarmentCard
                  key={garment.id}
                  garment={garment}
                  width={128}
                  onPress={() => router.push({ pathname: '/garment/[id]', params: { id: garment.id } })}
                />
              ))}
            </ScrollView>
          </>
        )}
      </View>

      {garments.length > 0 ? <QuickOccasions /> : null}
    </Screen>
  );
}

function ActionCard({ title, body, icon, dark, onPress }: { title: string; body: string; icon: React.ReactNode; dark?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        void haptic('medium');
        onPress();
      }}
      style={({ pressed }) => [
        styles.actionCard,
        dark && { backgroundColor: colors.charcoal, borderColor: 'rgba(0,0,0,0.1)' },
        { transform: [{ scale: pressed ? 0.98 : 1 }] },
      ]}
    >
      <View style={[styles.actionIcon, dark && { backgroundColor: 'rgba(255,255,255,0.15)' }]}>{icon}</View>
      <Txt style={{ fontFamily: fonts.sansSemi, fontSize: 13, color: dark ? colors.white : colors.charcoal }}>{title}</Txt>
      <Txt style={{ fontSize: 11, lineHeight: 14, marginTop: 2, color: dark ? 'rgba(255,255,255,0.7)' : colors.warmGray }}>{body}</Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  scanPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.charcoal,
  },
  jevCard: { marginTop: 12, padding: 18, borderRadius: radius.xl, backgroundColor: colors.charcoal },
  micBubble: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.ivory, alignItems: 'center', justifyContent: 'center' },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  actionCard: {
    flex: 1,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.stone,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  actionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.charcoal,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  avatarPrompt: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.mutedGray,
  },
  avatarIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.stone, alignItems: 'center', justifyContent: 'center' },
  hero: { borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.stone, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  heroCollage: { aspectRatio: 1 },
  heroText: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 4, paddingBottom: 16 },
  heroCta: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: colors.charcoal },
  empty: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.mutedGray,
  },
});
