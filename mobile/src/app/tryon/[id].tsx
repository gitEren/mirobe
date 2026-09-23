import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BookmarkCheck, BookmarkPlus, Camera, Film, ImageIcon, Info, Sparkles, Trash2, UserRound, X } from 'lucide-react-native';
import { garmentImage, isIsolated } from '@/components/garment';
import { isLivePhoto, relativeTime } from '@/components/tryon';
import { IconButton, Txt, haptic } from '@/components/ui';
import { mediaUrl } from '@/lib/api';
import {
  aiErrorMessage,
  deleteTryOn,
  ensureAiConsent,
  openWithAccount,
  refreshTryOn,
  requestMotionClip,
  requireAccount,
  saveLook,
  useStore,
  useStrings,
} from '@/lib/store';
import { colors, fonts, radius } from '@/lib/theme';

/** Full-screen view of one AI try-on: the dressed photo, its motion clip and the pieces used. */
export default function TryOnViewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useStrings();
  const lang = useStore((s) => s.lang);
  const tryon = useStore((s) => s.tryons.find((tr) => tr.id === id));
  const garments = useStore((s) => s.garments);
  const looks = useStore((s) => s.looks);
  // The look made from this render, or one with exactly these pieces (its cover may be another render).
  const savedLook = useMemo(() => {
    if (!tryon) return undefined;
    const key = [...tryon.garmentIds].sort().join(',');
    return looks.find((l) => l.tryonId === tryon.id) ?? looks.find((l) => [...l.garmentIds].sort().join(',') === key);
  }, [looks, tryon]);
  // Motion clips need a plan with videos (Pro); without them the button opens the Pro upsell.
  const paid = useStore((s) => (s.usage ? s.usage.videos.limit > 0 : false));
  const insets = useSafeAreaInsets();
  const [showVideo, setShowVideo] = useState(true);
  const [clipRequested, setClipRequested] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [info, setInfo] = useState(false);

  const videoUrl = tryon?.videoStatus === 'ready' ? mediaUrl(tryon.videoUrl) : undefined;
  const player = useVideoPlayer(videoUrl ?? null, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  const clipBusy = clipRequested || tryon?.videoStatus === 'processing';

  // Feedback is a toast, not a permanent caption over the photo.
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!tryon) return;
    if (tryon.videoStatus === 'processing') {
      const timer = setInterval(() => void refreshTryOn(tryon.id).catch(() => undefined), 4000);
      return () => clearInterval(timer);
    }
    if (clipRequested && (tryon.videoStatus === 'ready' || tryon.videoStatus === 'failed')) {
      setClipRequested(false);
      setShowVideo(true);
      setMessage(tryon.videoStatus === 'ready' ? t.mirror.clipReady : t.common.error);
      void haptic(tryon.videoStatus === 'ready' ? 'success' : 'warning');
    }
  }, [tryon, clipRequested, t]);

  if (!tryon) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <IconButton accessibilityLabel={t.common.close} onPress={() => router.back()}>
          <X size={18} color={colors.white} />
        </IconButton>
      </View>
    );
  }

  const items = tryon.garmentIds.map((gid) => garments.find((g) => g.id === gid)).filter((g) => g !== undefined);

  const requestClip = async () => {
    if (clipBusy || !requireAccount(`/tryon/${tryon.id}`)) return;
    if (!paid) return router.push('/paywall');
    // The try-on photo goes to the video model: the account allows AI processing first.
    if (!(await ensureAiConsent())) return;
    setClipRequested(true);
    setMessage(t.mirror.clipStarted);
    void haptic('medium');
    try {
      await requestMotionClip(tryon.id);
    } catch (error) {
      setClipRequested(false);
      setMessage(aiErrorMessage(error, t));
    }
  };

  const save = () => {
    if (savedLook) return router.push({ pathname: '/look/[id]', params: { id: savedLook.id } });
    saveLook({
      title: items.map((g) => g.subcategory || g.name).slice(0, 2).join(' + ') || 'Mirobe',
      occasion: '',
      style: '',
      garmentIds: tryon.garmentIds,
      source: 'manual',
      tryonId: tryon.id,
      coverUrl: tryon.imageUrl,
    });
    setMessage(t.stylist.saved);
    void haptic('success');
  };

  const remove = () =>
    Alert.alert(t.tryons.deleteTitle, t.tryons.deleteBody, [
      { text: t.common.cancel, style: 'cancel' },
      {
        text: t.common.delete,
        style: 'destructive',
        onPress: () => {
          void deleteTryOn(tryon.id)
            .then(() => router.back())
            .catch(() => setMessage(t.common.error));
        },
      },
    ]);

  // The action bar sits below the photo, so nothing covers the face or the shoes.
  const barHeight = 12 + 44 + insets.bottom + 12;
  const image = mediaUrl(tryon.imageUrl);
  const live = isLivePhoto(tryon);

  return (
    <View style={{ flex: 1, backgroundColor: colors.night }}>
      <View style={[styles.stage, { bottom: barHeight }]}>
        {/* A blurred copy fills the bands around the uncropped, head-to-toe photo. */}
        <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />
        {/* Below the status bar, so the head never sits under the Dynamic Island. */}
        <View style={[styles.media, { top: insets.top }]}>
          {videoUrl && showVideo ? (
            <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
          ) : (
            <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="contain" transition={250} />
          )}
        </View>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel={t.tryons.details} onPress={() => setInfo((v) => !v)} />
        <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.45)', 'transparent']} locations={[0, 0.16]} style={StyleSheet.absoluteFill} />
      </View>

      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <IconButton accessibilityLabel={t.common.close} onPress={() => router.back()}>
          <X size={17} color={colors.white} />
        </IconButton>
        <IconButton accessibilityLabel={t.common.delete} onPress={remove}>
          <Trash2 size={16} color={colors.white} />
        </IconButton>
      </View>

      {/* Details only on demand ("i" or a tap on the photo). */}
      <View pointerEvents="box-none" style={[styles.overlay, { bottom: barHeight }]}>
        {message ? (
          <View style={styles.message}>
            <Txt style={{ color: 'rgba(255,255,255,0.92)', fontSize: 12 }}>{message}</Txt>
          </View>
        ) : null}
        {info ? (
          <View style={styles.info}>
            <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.85)']} locations={[0, 0.45]} style={StyleSheet.absoluteFill} />
            <View style={styles.meta}>
              {live ? <Camera size={12} color={colors.amber} /> : <UserRound size={12} color={colors.amber} />}
              <Txt style={styles.metaText}>
                {live ? t.tryons.fromCameraLong : t.tryons.fromMirrorLong} · {relativeTime(tryon.createdAt, lang)}
              </Txt>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
              {items.map((garment) => (
                <Pressable key={garment.id} onPress={() => router.push({ pathname: '/garment/[id]', params: { id: garment.id } })} style={styles.item}>
                  <Image source={{ uri: garmentImage(garment) }} style={styles.itemImage} contentFit={isIsolated(garment) ? 'contain' : 'cover'} />
                  <Txt numberOfLines={1} style={{ color: 'rgba(255,255,255,0.85)', fontSize: 10, fontFamily: fonts.sansSemi, marginTop: 4 }}>
                    {garment.name}
                  </Txt>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </View>

      <View style={[styles.bar, { height: barHeight, paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          onPress={() => setInfo((v) => !v)}
          style={[styles.secondary, info && { backgroundColor: colors.gold, borderColor: colors.gold }]}
          accessibilityLabel={t.tryons.details}
        >
          <Info size={17} color={info ? '#171411' : colors.gold} />
        </Pressable>
        <Pressable onPress={save} style={styles.primary}>
          {savedLook ? <BookmarkCheck size={16} color="#171411" /> : <BookmarkPlus size={16} color="#171411" />}
          <Txt style={{ color: '#171411', fontFamily: fonts.sansBold, fontSize: 12 }}>{savedLook ? t.tryons.openLook : t.mirror.saveLook}</Txt>
        </Pressable>
        {videoUrl ? (
          <Pressable onPress={() => setShowVideo((v) => !v)} style={styles.secondary}>
            {showVideo ? <ImageIcon size={15} color={colors.gold} /> : <Film size={15} color={colors.gold} />}
            <Txt style={styles.secondaryText}>{showVideo ? t.mirror.showPhoto : t.mirror.showVideo}</Txt>
          </Pressable>
        ) : (
          <Pressable onPress={() => void requestClip()} disabled={clipBusy} style={[styles.secondary, clipBusy && { borderColor: colors.gold }]}>
            {clipBusy ? <ActivityIndicator size="small" color={colors.gold} /> : <Film size={15} color={colors.gold} />}
            <Txt style={styles.secondaryText}>{clipBusy ? t.mirror.clipBusy : paid ? t.looks.video : t.looks.videoLocked}</Txt>
          </Pressable>
        )}
        <Pressable
          onPress={() => openWithAccount(`/mirror?garmentIds=${encodeURIComponent(tryon.garmentIds.join(','))}`)}
          style={styles.secondary}
          accessibilityLabel={t.tryons.tryAgain}
        >
          <Sparkles size={15} color={colors.gold} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.night, padding: 16 },
  header: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  stage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    backgroundColor: colors.nightSurface,
  },
  media: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  overlay: { position: 'absolute', left: 0, right: 0, gap: 10 },
  info: { paddingTop: 40, paddingBottom: 14, gap: 10, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg, overflow: 'hidden' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16 },
  metaText: { color: 'rgba(255,255,255,0.85)', fontFamily: fonts.sansMedium, fontSize: 12 },
  message: {
    marginHorizontal: 16,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  item: { width: 70 },
  itemImage: { width: 70, height: 86, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.9)' },
  primary: {
    flex: 1,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.ivory,
  },
  secondary: {
    height: 44,
    minWidth: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  secondaryText: { color: colors.white, fontFamily: fonts.sansSemi, fontSize: 12 },
});
