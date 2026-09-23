import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import { AccountGate } from '@/components/AccountGate';
import { CameraSurface, type CameraSurfaceHandle } from '@/components/CameraSurface';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { RTCView, type MediaStream } from 'react-native-webrtc';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BookmarkPlus, Camera, Film, ImageIcon, Radio, ScanLine, Sparkles, SwitchCamera, X } from 'lucide-react-native';
import { GARMENT_CATEGORIES, LIVE_MIRROR_ENABLED, labelFor, type GarmentCategory, type TryOnRow } from '@mirobe/shared';
import { garmentImage, isIsolated } from '@/components/garment';
import { Chip, IconButton, Txt, haptic } from '@/components/ui';
import { api, ApiError, mediaUrl } from '@/lib/api';
import { upper } from '@/lib/i18n';
import { persistPhoto, uploadLocalPhoto } from '@/lib/media';
import { startLiveSession, type LiveSession } from '@/lib/live';
import {
  aiErrorMessage,
  ensureAiConsent,
  getState,
  refreshTryOn,
  refreshUsage,
  requestMotionClip,
  requireAccount,
  saveLook,
  selectActiveAvatar,
  tryOnOutfit,
  useStore,
  useStrings,
} from '@/lib/store';
import { colors, fonts, radius } from '@/lib/theme';

type LiveStatus = 'idle' | 'connecting' | 'live';

/** One garment per slot; a dress replaces top + bottom. */
function toggleInOutfit(current: string[], id: string): string[] {
  if (current.includes(id)) return current.filter((x) => x !== id);
  const garments = getState().garments;
  const category = garments.find((g) => g.id === id)?.category;
  const conflicts = (other?: GarmentCategory | null) =>
    other === category ||
    (category === 'dress' && (other === 'top' || other === 'bottom')) ||
    ((category === 'top' || category === 'bottom') && other === 'dress');
  return [...current.filter((x) => !conflicts(garments.find((g) => g.id === x)?.category)), id];
}

/** Anonymous visitors sign in first; the screen's params survive the detour. */
export default function MirrorScreen() {
  const params = useLocalSearchParams();
  return (
    <AccountGate route="/mirror" params={params} dark>
      <Mirror />
    </AccountGate>
  );
}

function Mirror() {
  const params = useLocalSearchParams<{ garmentIds?: string; render?: string; source?: 'avatar' }>();
  const t = useStrings();
  const lang = useStore((s) => s.lang);
  const insets = useSafeAreaInsets();
  const garments = useStore((s) => s.garments);
  const tryons = useStore((s) => s.tryons);
  const avatar = useStore(selectActiveAvatar);
  const usage = useStore((s) => s.usage);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [selected, setSelected] = useState<string[]>(() => (params.garmentIds ? params.garmentIds.split(',').filter(Boolean) : []));
  const [category, setCategory] = useState<GarmentCategory | 'all'>('all');
  const [railOpen, setRailOpen] = useState(!params.garmentIds);
  const [resultId, setResultId] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [savedLook, setSavedLook] = useState(false);
  const camera = useRef<CameraSurfaceHandle>(null);
  /** Synchronous in-flight guard: `rendering` state lags a render behind, so a fast double tap could start two paid renders. */
  const renderingRef = useRef(false);
  /** The person being dressed: a frozen camera frame (local + uploaded) until the user returns to the camera. */
  const [person, setPerson] = useState<{ localUri: string; url: string | null } | null>(null);
  const [clipRequestedFor, setClipRequestedFor] = useState<string | null>(null);
  const [showVideo, setShowVideo] = useState(true);
  /** Height of the bottom controls; the dressed photo is laid out above them so they never hide the shoes. */
  const [controlsHeight, setControlsHeight] = useState(0);

  const result: TryOnRow | undefined = tryons.find((tr) => tr.id === resultId);
  const hasResult = Boolean(result);
  const selectedGarments = selected.map((id) => garments.find((g) => g.id === id)).filter((g) => g !== undefined);
  const ready = garments.filter((g) => g.taggingStatus === 'ready');
  const railGarments = category === 'all' ? ready : ready.filter((g) => g.category === category);
  const imagesLeft = usage ? Math.max(0, usage.images.limit - usage.images.used) : null;
  const videosLeft = usage ? Math.max(0, usage.videos.limit - usage.videos.used) : 0;
  // Motion clips (and the live mirror, while it is switched on) need a plan with videos (Pro).
  const paid = usage ? usage.videos.limit > 0 : false;

  // ---------------------------------------------------------------- photo try-on
  const backToCamera = () => {
    setResultId(null);
    setPerson(null);
    setMessage(null);
  };

  /**
   * With the camera open, freezes the current frame and dresses that photo.
   * With a result on screen, re-dresses the same photo with the new selection.
   * Without a camera, falls back to the saved mirror photo.
   */
  const renderPhoto = useCallback(async () => {
    if (renderingRef.current || selected.length === 0 || !requireAccount('/mirror')) return;
    renderingRef.current = true;
    // Nothing is captured or sent before the account allowed AI processing; "Not now" leaves the mirror as it was.
    if (!(await ensureAiConsent())) {
      renderingRef.current = false;
      return;
    }
    setRendering(true);
    setSavedLook(false);
    void haptic('medium');
    try {
      let personUrl = person?.url ?? undefined;
      if (person && !person.url) {
        // The frozen frame's upload failed last time: upload it again instead of dressing the saved mirror photo.
        setMessage(t.mirror.rendering);
        personUrl = await uploadLocalPhoto(person.localUri);
        setPerson({ localUri: person.localUri, url: personUrl });
      } else if (!person && params.source !== 'avatar' && camera.current && permission?.granted) {
        const shot = await camera.current.takePictureAsync({ quality: 0.9 });
        if (shot) {
          setPerson({ localUri: shot.uri, url: null });
          setMessage(t.mirror.rendering);
          const stored = await persistPhoto(shot.uri, shot);
          personUrl = await uploadLocalPhoto(stored);
          setPerson({ localUri: stored, url: personUrl });
        }
      }
      if (!personUrl && !avatar) {
        router.push('/avatar');
        return;
      }
      setMessage(t.mirror.rendering);
      const { tryon, cached } = await tryOnOutfit(selected, personUrl);
      setResultId(tryon.id);
      // Give the result the room: the wardrobe rail would shrink the photo.
      setRailOpen(false);
      setShowVideo(true);
      setMessage(cached ? t.looks.cached : null);
      void haptic('success');
    } catch (error) {
      const code = error instanceof ApiError ? error.code : undefined;
      const failure = code === 'AVATAR_REQUIRED' ? t.mirror.noAvatar : aiErrorMessage(error, t);
      setMessage(failure);
      if (failure) void haptic('warning');
    } finally {
      renderingRef.current = false;
      setRendering(false);
    }
  }, [avatar, person, permission?.granted, selected, t]);

  // Over a result, feedback is a short toast rather than a caption on the photo.
  useEffect(() => {
    if (!message || rendering || !hasResult) return;
    const timer = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(timer);
  }, [message, rendering, hasResult]);

  useEffect(() => {
    if (params.render !== '1' || selected.length === 0) return;
    // Consume the flag before rendering: a remount or a dev Fast Refresh re-runs this effect,
    // and must never start a second paid render for the same navigation.
    router.setParams({ render: undefined });
    void renderPhoto();
    // Only on first mount with a preselected outfit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- motion clip
  const clipBusy = Boolean(result && (clipRequestedFor === result.id || result.videoStatus === 'processing'));

  const requestClip = async () => {
    if (!result || clipBusy || !requireAccount('/mirror')) return;
    if (!paid) {
      router.push('/paywall');
      return;
    }
    // The try-on photo goes to the video model: the account allows AI processing first.
    if (!(await ensureAiConsent())) return;
    // Immediate feedback: the request itself takes a few seconds, the clip about a minute.
    setClipRequestedFor(result.id);
    setMessage(t.mirror.clipStarted);
    void haptic('medium');
    try {
      await requestMotionClip(result.id);
    } catch (error) {
      setClipRequestedFor(null);
      setMessage(aiErrorMessage(error, t));
    }
  };

  useEffect(() => {
    if (!result) return;
    if (result.videoStatus === 'processing') {
      const timer = setInterval(() => void refreshTryOn(result.id).catch(() => undefined), 4000);
      return () => clearInterval(timer);
    }
    if (clipRequestedFor === result.id && (result.videoStatus === 'ready' || result.videoStatus === 'failed')) {
      setClipRequestedFor(null);
      setShowVideo(true);
      setMessage(result.videoStatus === 'ready' ? t.mirror.clipReady : t.common.error);
      void haptic(result.videoStatus === 'ready' ? 'success' : 'warning');
    }
  }, [result, clipRequestedFor, t]);

  // ---------------------------------------------------------------- live mirror
  // Switched off (LIVE_MIRROR_ENABLED): no button starts it, so liveStatus stays 'idle'.
  // The code stays for a later release.
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('idle');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [liveLeft, setLiveLeft] = useState(0);
  const live = useRef<{ session: LiveSession | null; sessionId: string; startedAt: number; timer?: ReturnType<typeof setInterval> }>({
    session: null,
    sessionId: '',
    startedAt: 0,
  });

  const stopLive = useCallback((note?: string) => {
    const current = live.current;
    if (current.timer) clearInterval(current.timer);
    current.session?.close();
    if (current.sessionId) {
      const used = current.startedAt ? (Date.now() - current.startedAt) / 1000 : 0;
      void api.liveStop(current.sessionId, used).then(() => refreshUsage()).catch(() => undefined);
    }
    live.current = { session: null, sessionId: '', startedAt: 0 };
    setRemoteStream(null);
    setLocalStream(null);
    setLiveStatus('idle');
    if (note) setMessage(note);
  }, []);

  useEffect(() => () => stopLive(), [stopLive]);

  // A live session must not keep running (and billing) while the app is in the background.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'background' && live.current.sessionId) stopLive();
    });
    return () => subscription.remove();
  }, [stopLive]);

  const startLive = async () => {
    const garment = selectedGarments.find((g) => g.category !== 'shoes' && g.category !== 'accessory') ?? selectedGarments[0];
    if (!LIVE_MIRROR_ENABLED || !garment || !requireAccount('/mirror')) return;
    if (!paid || videosLeft <= 0) {
      router.push('/paywall');
      return;
    }
    if (!(await ensureAiConsent())) return;
    setLiveStatus('connecting');
    setResultId(null);
    setMessage(t.mirror.connecting);
    try {
      const start = await api.liveStart(garment.id);
      live.current.sessionId = start.sessionId;
      const session = await startLiveSession(start, {
        onRemoteStream: (stream) => {
          if (live.current.sessionId !== start.sessionId) return; // stopped meanwhile
          setRemoteStream(stream);
          // ontrack fires per track and again after an ICE restart: start the clock and timer only once.
          if (live.current.startedAt) return;
          setLiveStatus('live');
          setMessage(null);
          live.current.startedAt = Date.now();
          setLiveLeft(start.allowedSeconds);
          live.current.timer = setInterval(() => {
            const left = start.allowedSeconds - Math.floor((Date.now() - live.current.startedAt) / 1000);
            setLiveLeft(Math.max(0, left));
            if (left <= 0) stopLive(t.mirror.liveEnded);
          }, 500);
        },
        onError: () => stopLive(t.mirror.liveUnavailable),
      });
      live.current.session = session;
      setLocalStream(session.localStream);
      setTimeout(() => {
        if (live.current.session === session && !live.current.startedAt) stopLive(t.mirror.liveUnavailable);
      }, 15000);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : undefined;
      stopLive(code === 'PLAN_REQUIRED' || code === 'QUOTA_EXCEEDED' ? t.common.quota : t.mirror.liveUnavailable);
    }
  };

  // ---------------------------------------------------------------- render
  const videoUrl = result?.videoStatus === 'ready' ? mediaUrl(result.videoUrl) : undefined;
  const player = useVideoPlayer(videoUrl ?? null, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  const cameraActive = liveStatus === 'idle' && !result && !person && permission?.granted;
  const statusLabel = liveStatus === 'live' ? 'AI LIVE' : liveStatus === 'connecting' ? upper(t.mirror.connecting, lang) : result ? 'AI PHOTO' : 'PREVIEW';

  const categories = useMemo(() => GARMENT_CATEGORIES.filter((c) => ready.some((g) => g.category === c)), [ready]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.night }}>
      {/* Stage */}
      <View style={StyleSheet.absoluteFill}>
        {cameraActive ? <CameraSurface ref={camera} style={StyleSheet.absoluteFill} facing={facing} /> : null}
        {/* The frozen frame stays on screen while it is being dressed. */}
        {person && !result && liveStatus === 'idle' ? (
          <Image source={{ uri: person.localUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : null}
        {liveStatus !== 'idle' && localStream && !remoteStream ? (
          <RTCView streamURL={localStream.toURL()} mirror objectFit="cover" style={StyleSheet.absoluteFill} />
        ) : null}
        {remoteStream ? <RTCView streamURL={remoteStream.toURL()} mirror objectFit="cover" style={StyleSheet.absoluteFill} zOrder={1} /> : null}
        {result?.imageUrl && liveStatus === 'idle' ? (
          // The whole dressed photo, head to shoes, above the controls.
          <View style={[styles.result, { bottom: controlsHeight + 6 }]}>
            <Image source={{ uri: mediaUrl(result.imageUrl) }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} />
            <View style={[styles.resultMedia, { top: insets.top }]}>
              {videoUrl && showVideo ? (
                <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
              ) : (
                <Image source={{ uri: mediaUrl(result.imageUrl) }} style={StyleSheet.absoluteFill} contentFit="contain" transition={400} />
              )}
            </View>
          </View>
        ) : null}
        {!permission?.granted && liveStatus === 'idle' && !result ? (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            {avatar ? <Image source={{ uri: mediaUrl(avatar.imageUrl) }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
            <Pressable onPress={() => void requestPermission()} style={styles.pill}>
              <Txt style={{ color: colors.white, fontSize: 12 }}>{t.scan.grant}</Txt>
            </Pressable>
          </View>
        ) : null}
        <LinearGradient
          pointerEvents="none"
          // Over a result only the header needs contrast; a deep top gradient would darken the face.
          colors={result ? ['rgba(0,0,0,0.5)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)'] : ['rgba(0,0,0,0.62)', 'rgba(0,0,0,0.04)', 'rgba(0,0,0,0.08)', 'rgba(0,0,0,0.92)']}
          locations={result ? [0, 0.14, 0.5, 1] : [0, 0.3, 0.53, 1]}
          style={StyleSheet.absoluteFill}
        />
        {rendering ? (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' }]}>
            <ActivityIndicator color={colors.gold} size="large" />
          </View>
        ) : null}
      </View>

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <IconButton
            accessibilityLabel={t.common.close}
            onPress={() => {
              stopLive();
              router.back();
            }}
          >
            <X size={17} color={colors.white} />
          </IconButton>
          <View style={styles.pill}>
            <View style={[styles.dot, { backgroundColor: liveStatus === 'live' ? colors.emerald : colors.amber }]} />
            <Txt style={styles.pillText}>{statusLabel}</Txt>
          </View>
        </View>
        {result ? null : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Sparkles size={13} color={colors.amber} />
            <Txt style={{ color: 'rgba(255,255,255,0.9)', fontFamily: fonts.sansSemi, fontSize: 11, letterSpacing: 2.5 }}>{t.mirror.title}</Txt>
          </View>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {liveStatus === 'live' ? (
            <View style={styles.pill}>
              <Txt style={[styles.pillText, { fontVariant: ['tabular-nums'] }]}>{t.mirror.remaining(liveLeft)}</Txt>
            </View>
          ) : null}
          {result ? (
            <IconButton accessibilityLabel={t.mirror.back} onPress={backToCamera}>
              <Camera size={17} color={colors.white} />
            </IconButton>
          ) : (
            <IconButton accessibilityLabel="flip" onPress={() => setFacing((f) => (f === 'front' ? 'back' : 'front'))}>
              <SwitchCamera size={17} color={colors.white} />
            </IconButton>
          )}
        </View>
      </View>

      {cameraActive && !message && selectedGarments.some((g) => g.category === 'shoes') ? (
        <View style={[styles.message, { top: insets.top + 60 }]}>
          <Txt style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12 }}>{t.mirror.fullBodyHint}</Txt>
        </View>
      ) : null}
      {message ? (
        <View style={[styles.message, { top: insets.top + 60 }]}>
          <Txt style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12 }}>{message}</Txt>
        </View>
      ) : null}

      {/* Controls */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 10 }]} onLayout={(e) => setControlsHeight(e.nativeEvent.layout.height)}>
        <View style={styles.outfitRow}>
          <View style={styles.outfitSummary}>
            <Txt numberOfLines={1} style={{ color: colors.white, fontFamily: fonts.sansSemi, fontSize: 13 }}>
              {selectedGarments.length ? selectedGarments.map((g) => g.name).join(' · ') : t.mirror.selectHint}
            </Txt>
            <Txt style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, marginTop: 2 }}>
              {t.common.pieces(selectedGarments.length)}
              {imagesLeft !== null ? `  ·  ${t.mirror.imagesLeft(imagesLeft)}` : ''}
            </Txt>
          </View>
          {result?.status === 'ready' && !savedLook ? (
            <IconButton
              accessibilityLabel={t.mirror.saveLook}
              size={40}
              onPress={() => {
                saveLook({
                  title: selectedGarments.map((g) => g.subcategory || g.name).slice(0, 2).join(' + ') || 'Mirobe',
                  occasion: '',
                  style: '',
                  garmentIds: selected,
                  source: 'manual',
                  tryonId: result.id,
                  coverUrl: result.imageUrl,
                });
                setSavedLook(true);
                void haptic('success');
              }}
            >
              <BookmarkPlus size={17} color={colors.gold} />
            </IconButton>
          ) : null}
        </View>

        <View style={styles.actions}>
          {liveStatus === 'idle' ? (
            <>
              <Pressable
                onPress={() => void renderPhoto()}
                disabled={rendering || selected.length === 0}
                style={({ pressed }) => [styles.photoButton, (rendering || selected.length === 0) && { opacity: 0.5 }, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}
              >
                {rendering ? <ActivityIndicator size="small" color="#171411" /> : <Camera size={16} color="#171411" />}
                <Txt style={{ color: '#171411', fontFamily: fonts.sansBold, fontSize: 12 }}>
                  {rendering ? t.mirror.rendering : result || person ? t.mirror.redress : cameraActive ? t.mirror.captureTry : t.mirror.photoTry}
                </Txt>
              </Pressable>
              {result?.status === 'ready' ? (
                result.videoStatus === 'ready' ? (
                  <Pressable onPress={() => setShowVideo((v) => !v)} style={styles.secondaryButton}>
                    {showVideo ? <ImageIcon size={15} color={colors.gold} /> : <Film size={15} color={colors.gold} />}
                    <Txt style={styles.secondaryText}>{showVideo ? t.mirror.showPhoto : t.mirror.showVideo}</Txt>
                  </Pressable>
                ) : (
                  <Pressable onPress={() => void requestClip()} disabled={clipBusy} style={[styles.secondaryButton, clipBusy && { borderColor: colors.gold }]}>
                    {clipBusy ? <ActivityIndicator size="small" color={colors.gold} /> : <Film size={15} color={colors.gold} />}
                    <Txt style={styles.secondaryText}>{clipBusy ? t.mirror.clipBusy : paid ? t.looks.video : t.looks.videoLocked}</Txt>
                  </Pressable>
                )
              ) : LIVE_MIRROR_ENABLED ? (
                <Pressable onPress={() => void startLive()} disabled={selected.length === 0} style={[styles.secondaryButton, selected.length === 0 && { opacity: 0.5 }]}>
                  <Radio size={15} color={colors.gold} />
                  <Txt style={styles.secondaryText}>{paid ? t.mirror.live : t.mirror.liveLocked}</Txt>
                </Pressable>
              ) : null}
            </>
          ) : (
            <Pressable onPress={() => stopLive()} style={[styles.photoButton, { backgroundColor: colors.white }]}>
              {liveStatus === 'connecting' ? <ActivityIndicator size="small" color="#171411" /> : null}
              <Txt style={{ color: '#171411', fontFamily: fonts.sansBold, fontSize: 12 }}>{t.mirror.stop}</Txt>
            </Pressable>
          )}
        </View>

        {railOpen ? (
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <FlatList
                horizontal
                data={['all', ...categories] as const}
                keyExtractor={(c) => c}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6 }}
                style={{ flex: 1 }}
                renderItem={({ item }) => (
                  <Chip dark small label={item === 'all' ? t.wardrobe.all : labelFor(item, lang)} active={category === item} onPress={() => setCategory(item)} />
                )}
              />
              <Chip dark small label={t.common.done} onPress={() => setRailOpen(false)} />
            </View>
            <FlatList
              horizontal
              data={railGarments}
              keyExtractor={(g) => g.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, padding: 8 }}
              style={styles.rail}
              ListHeaderComponent={
                <Pressable onPress={() => router.push('/scan')} style={styles.scanTile}>
                  <ScanLine size={20} color="#FDE68A" />
                  <Txt style={{ color: '#FDE68A', fontSize: 10, marginTop: 4 }}>{t.scan.title}</Txt>
                </Pressable>
              }
              renderItem={({ item }) => {
                const active = selected.includes(item.id);
                return (
                  <Pressable
                    onPress={() => {
                      void haptic('light');
                      setSelected((current) => toggleInOutfit(current, item.id));
                    }}
                    style={[styles.railItem, active && { backgroundColor: colors.white, borderColor: colors.amber, borderWidth: 2 }]}
                  >
                    <Image source={{ uri: garmentImage(item) }} style={styles.railImage} contentFit={isIsolated(item) ? 'contain' : 'cover'} />
                    <Txt numberOfLines={1} style={{ fontSize: 9, fontFamily: fonts.sansSemi, marginTop: 4, color: active ? '#000' : 'rgba(255,255,255,0.85)' }}>
                      {item.name}
                    </Txt>
                  </Pressable>
                );
              }}
            />
          </View>
        ) : (
          <Pressable onPress={() => setRailOpen(true)} style={styles.railClosed}>
            <View style={styles.openRail}>
              <Txt style={{ color: '#000', fontSize: 11, fontFamily: fonts.sansSemi }}>✦ {t.mirror.openWardrobe}</Txt>
            </View>
            <Txt numberOfLines={1} style={{ flex: 1, color: 'rgba(255,255,255,0.65)', fontSize: 11 }}>
              {selectedGarments.map((g) => g.name).join(' · ')}
            </Txt>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  pillText: { color: 'rgba(255,255,255,0.9)', fontFamily: fonts.sansMedium, fontSize: 10, letterSpacing: 0.8 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  message: {
    position: 'absolute',
    left: 14,
    maxWidth: '80%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, gap: 10 },
  result: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    backgroundColor: colors.nightSurface,
  },
  resultMedia: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  outfitRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  outfitSummary: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    padding: 8,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  photoButton: {
    flex: 1,
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.ivory,
  },
  secondaryButton: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.64)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  secondaryText: { color: colors.white, fontFamily: fonts.sansSemi, fontSize: 12 },
  rail: { flexGrow: 0, borderRadius: radius.lg, backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.1)' },
  railItem: { width: 78, padding: 5, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 2, borderColor: 'transparent' },
  railImage: { width: '100%', aspectRatio: 1, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.9)' },
  scanTile: {
    width: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(253,230,138,0.45)',
    backgroundColor: 'rgba(253,230,138,0.1)',
  },
  railClosed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  openRail: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.white },
});
