import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, ChevronLeft, Film, Sparkles, Trash2 } from 'lucide-react-native';
import { labelFor } from '@mirobe/shared';
import { garmentImage, isIsolated } from '@/components/garment';
import { LookCover } from '@/components/look';
import { TryOnThumb } from '@/components/tryon';
import { Banner, Button, IconButton, SectionHeader, Txt, haptic } from '@/components/ui';
import { mediaUrl } from '@/lib/api';
import {
  aiErrorMessage,
  deleteLook,
  ensureAiConsent,
  openWithAccount,
  refreshTryOn,
  requestMotionClip,
  requireAccount,
  selectActiveAvatar,
  tryOnOutfit,
  updateLook,
  useStore,
  useStrings,
} from '@/lib/store';
import { colors, fonts, radius } from '@/lib/theme';

export default function LookDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useStrings();
  const lang = useStore((s) => s.lang);
  const look = useStore((s) => s.looks.find((l) => l.id === id));
  const garments = useStore((s) => s.garments);
  const tryon = useStore((s) => s.tryons.find((tr) => tr.id === look?.tryonId));
  const tryons = useStore((s) => s.tryons);
  // Every render of exactly these pieces, on a live photo or the mirror photo; the look's cover is one of them.
  const history = useMemo(() => {
    const key = look ? [...look.garmentIds].sort().join(',') : '';
    return tryons.filter((tr) => tr.status === 'ready' && tr.imageUrl && [...tr.garmentIds].sort().join(',') === key);
  }, [tryons, look]);
  const avatar = useStore(selectActiveAvatar);
  // Motion clips need a plan with videos (Pro); without them the button opens the Pro upsell.
  const paid = useStore((s) => (s.usage ? s.usage.videos.limit > 0 : false));
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const videoUrl = tryon?.videoStatus === 'ready' ? mediaUrl(tryon.videoUrl) : undefined;
  const player = useVideoPlayer(videoUrl ?? null, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  useEffect(() => {
    if (tryon?.videoStatus !== 'processing') return;
    const timer = setInterval(() => void refreshTryOn(tryon.id).catch(() => undefined), 4000);
    return () => clearInterval(timer);
  }, [tryon?.id, tryon?.videoStatus]);

  if (!look) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ivory }}>
        <Button title={t.common.close} tone="ghost" onPress={() => router.back()} />
      </View>
    );
  }

  const items = look.garmentIds.map((gid) => garments.find((g) => g.id === gid)).filter((g) => g !== undefined);

  const render = async () => {
    if (!requireAccount(`/look/${look.id}`)) return;
    if (!avatar) return router.push('/avatar');
    // The mirror photo and the pieces go to the AI models: the account allows that first.
    if (!(await ensureAiConsent())) return;
    setBusy(true);
    setNotice(t.looks.rendering);
    try {
      const result = await tryOnOutfit(look.garmentIds);
      updateLook(look.id, { tryonId: result.tryon.id, coverUrl: result.tryon.imageUrl });
      setNotice(result.cached ? t.looks.cached : null);
      void haptic('success');
    } catch (error) {
      setNotice(aiErrorMessage(error, t));
    } finally {
      setBusy(false);
    }
  };

  const clip = async () => {
    if (!tryon || !requireAccount(`/look/${look.id}`)) return;
    if (!paid) return router.push('/paywall');
    // The try-on photo goes to the video model: the account allows AI processing first.
    if (!(await ensureAiConsent())) return;
    try {
      await requestMotionClip(tryon.id);
    } catch (error) {
      setNotice(aiErrorMessage(error, t));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 110 }} showsVerticalScrollIndicator={false}>
        <Pressable
          // Try-ons are full length: show them whole, shoes included, rather than cropping to 3:4.
          style={[styles.hero, tryon?.imageUrl ? { height: insets.top + Math.min((screen.width * 16) / 9, screen.height * 0.72) } : { aspectRatio: 3 / 4 }]}
          disabled={!tryon?.imageUrl}
          onPress={() => tryon && router.push({ pathname: '/tryon/[id]', params: { id: tryon.id } })}
        >
          {tryon?.imageUrl ? (
            <>
              <Image source={{ uri: mediaUrl(tryon.imageUrl) }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} />
              {/* Below the status bar, so the head never sits under the Dynamic Island. */}
              <View style={[styles.heroMedia, { top: insets.top }]}>
                {videoUrl ? (
                  <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
                ) : (
                  <Image source={{ uri: mediaUrl(tryon.imageUrl) }} style={StyleSheet.absoluteFill} contentFit="contain" transition={300} />
                )}
              </View>
            </>
          ) : (
            <LookCover look={look} />
          )}
          <View style={[styles.heroTop, { top: insets.top + 8 }]}>
            <IconButton accessibilityLabel={t.common.close} onPress={() => router.back()}>
              <ChevronLeft size={20} color={colors.white} />
            </IconButton>
            <IconButton
              accessibilityLabel={t.looks.delete}
              onPress={() =>
                Alert.alert(t.looks.delete, '', [
                  { text: t.common.cancel, style: 'cancel' },
                  {
                    text: t.common.delete,
                    style: 'destructive',
                    onPress: () => {
                      deleteLook(look.id);
                      router.back();
                    },
                  },
                ])
              }
            >
              <Trash2 size={17} color={colors.white} />
            </IconButton>
          </View>
        </Pressable>

        <View style={{ padding: 20, gap: 14 }}>
          <View>
            {look.occasion ? <Txt variant="label">{labelFor(look.occasion, lang)}</Txt> : null}
            <Txt variant="title" style={{ marginTop: 4 }}>
              {look.title}
            </Txt>
            {look.note ? (
              <Txt variant="serif" style={{ fontSize: 16, marginTop: 6 }}>
                “{look.note}”
              </Txt>
            ) : null}
          </View>
          {notice ? <Banner text={notice} /> : null}
          {tryon?.videoStatus === 'processing' ? <Banner text={t.looks.videoProcessing} /> : null}

          <View>
            <SectionHeader title={t.looks.history} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}>
              <Pressable
                accessibilityLabel={t.looks.tryOnCamera}
                onPress={() => openWithAccount(`/mirror?garmentIds=${encodeURIComponent(look.garmentIds.join(','))}`)}
                style={({ pressed }) => [styles.cameraTile, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}
              >
                <View style={styles.cameraIcon}>
                  <Camera size={17} color={colors.amber} />
                </View>
                <Txt style={{ fontFamily: fonts.sansSemi, fontSize: 11, textAlign: 'center', color: colors.charcoal }}>{t.looks.tryOnCamera}</Txt>
              </Pressable>
              {history.map((item) => (
                <TryOnThumb
                  key={item.id}
                  tryon={item}
                  width={92}
                  selected={item.id === tryon?.id}
                  onPress={() => {
                    if (item.id === tryon?.id) return router.push({ pathname: '/tryon/[id]', params: { id: item.id } });
                    updateLook(look.id, { tryonId: item.id, coverUrl: item.imageUrl });
                    void haptic('light');
                  }}
                />
              ))}
            </ScrollView>
            {history.length > 1 ? (
              <Txt variant="tiny" style={{ marginTop: 8 }}>
                {t.looks.historyHint}
              </Txt>
            ) : null}
          </View>

          <View style={{ gap: 10 }}>
            {items.map((garment) => (
              <Pressable key={garment.id} onPress={() => router.push({ pathname: '/garment/[id]', params: { id: garment.id } })} style={styles.item}>
                <Image source={{ uri: garmentImage(garment) }} style={styles.itemImage} contentFit={isIsolated(garment) ? 'contain' : 'cover'} />
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyStrong">{garment.name}</Txt>
                  <Txt variant="caption">{garment.category ? labelFor(garment.category, lang) : ''}</Txt>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Button
          title={busy ? t.looks.rendering : t.looks.tryOnMirror}
          loading={busy}
          icon={<Sparkles size={16} color={colors.amber} />}
          onPress={() => void render()}
          style={{ flex: 1 }}
        />
        {tryon?.status === 'ready' && tryon.videoStatus !== 'ready' ? (
          <Button
            title={paid ? t.looks.video : t.looks.videoLocked}
            tone="secondary"
            loading={tryon.videoStatus === 'processing'}
            icon={<Film size={15} color={colors.charcoal} />}
            onPress={() => void clip()}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { overflow: 'hidden', backgroundColor: colors.stone },
  heroMedia: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  heroTop: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 8,
    borderRadius: radius.md,
    backgroundColor: colors.stone,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  itemImage: { width: 56, height: 70, borderRadius: 10, backgroundColor: colors.stoneCard },
  cameraTile: {
    width: 92,
    aspectRatio: 9 / 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 8,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    backgroundColor: colors.stone,
  },
  cameraIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.charcoal },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: 'rgba(251,249,245,0.95)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
