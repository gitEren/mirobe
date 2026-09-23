import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import { AccountGate } from '@/components/AccountGate';
import { CameraSurface, type CameraSurfaceHandle } from '@/components/CameraSurface';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ImageIcon, SwitchCamera, Wand2, X } from 'lucide-react-native';
import type { GarmentRow } from '@mirobe/shared';
import { Button, Chip, IconButton, Txt, haptic } from '@/components/ui';
import { addGarmentFromPhoto, addGarmentsFromLibrary } from '@/lib/addGarments';
import { upper } from '@/lib/i18n';
import {
  ensureAiConsent,
  getState,
  queueAutoStudio,
  selectImagesLeft,
  setStudioAtCapture,
  studioAtCapturePreferred,
  useStore,
  useStrings,
} from '@/lib/store';
import { colors, fonts, radius } from '@/lib/theme';

type Mode = 'flat' | 'wearing';

/** Anonymous visitors sign in first: the camera never opens for them. */
export default function ScanScreen() {
  return (
    <AccountGate route="/scan" dark>
      <Scan />
    </AccountGate>
  );
}

function Scan() {
  const t = useStrings();
  const lang = useStore((s) => s.lang);
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraSurfaceHandle>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<Mode>('flat');
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<{ id: string; uri: string }[]>([]);
  const aiConsent = useStore((s) => s.aiConsent);
  const askedConsent = useRef(false);
  /** "Also create a studio image": remembered on the device, on by default. */
  const [studio, setStudio] = useState(studioAtCapturePreferred);
  /** This month's images still free (queued studio images counted); null until the usage is known. */
  const imagesLeft = useStore(selectImagesLeft);
  const [studioNote, setStudioNote] = useState<string | null>(null);
  /** A studio image was queued in this scan: running out afterwards is worth a note (once). */
  const queuedStudio = useRef(false);
  const studioOn = studio && imagesLeft !== null && imagesLeft > 0;

  const source: GarmentRow['source'] = mode === 'wearing' ? 'wearing' : 'camera';

  const remember = ({ garment, imageUri }: { garment: GarmentRow; imageUri: string }) => {
    setAdded((list) => [{ id: garment.id, uri: imageUri }, ...list]);
    // The studio image is requested once the piece is tagged (it uses the tags). The cost is
    // on this screen, so there is no second confirmation. Out of images: said once, the
    // rest are added without one.
    if (studio) {
      if (queueAutoStudio(garment.id)) queuedStudio.current = true;
      else if (queuedStudio.current && selectImagesLeft(getState()) === 0) setStudioNote(t.scan.studioRanOut);
    }
    // Tagging sends the photo to the AI models. Asked once per scan, once the first piece is
    // safely added: on "Not now" the pieces stay in the wardrobe, untagged.
    if (!getState().aiConsent && !askedConsent.current) {
      askedConsent.current = true;
      void ensureAiConsent();
    }
  };

  const capture = async () => {
    if (!camera.current || busy) return;
    setBusy(true);
    try {
      void haptic('medium');
      // A front-camera ("on me") photo is stored the right way round, so printed text stays readable.
      const photo = await camera.current.takePictureAsync({ quality: 0.85, unmirror: true });
      if (photo) {
        remember(await addGarmentFromPhoto(photo.uri, { width: photo.width, height: photo.height }, source));
        void haptic('success');
      }
    } finally {
      setBusy(false);
    }
  };

  const pickFromGallery = async () => {
    setBusy(true);
    try {
      if ((await addGarmentsFromLibrary(remember)) > 0) void haptic('success');
    } finally {
      setBusy(false);
    }
  };

  if (!permission) return <View style={{ flex: 1, backgroundColor: colors.night }} />;

  if (!permission.granted) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Txt style={{ color: colors.white, textAlign: 'center', marginBottom: 20 }}>{t.scan.permission}</Txt>
        <Button title={t.scan.grant} tone="light" onPress={() => void requestPermission()} />
        <Button title={t.common.cancel} tone="glass" onPress={() => router.back()} style={{ marginTop: 10 }} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.night }}>
      <CameraSurface ref={camera} style={StyleSheet.absoluteFill} facing={facing} />

      {/* Framing guide */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <View style={styles.frame}>
          {['tl', 'tr', 'bl', 'br'].map((corner) => (
            <View key={corner} style={[styles.corner, cornerStyle(corner)]} />
          ))}
        </View>
      </View>

      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <IconButton accessibilityLabel={t.common.close} onPress={() => router.back()}>
          <X size={18} color={colors.white} />
        </IconButton>
        <Txt style={{ color: colors.white, fontFamily: fonts.sansSemi, letterSpacing: 2, fontSize: 12 }}>{upper(t.scan.title, lang)}</Txt>
        <IconButton accessibilityLabel="flip" onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}>
          <SwitchCamera size={18} color={colors.white} />
        </IconButton>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.hint}>
          <Txt style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, textAlign: 'center' }}>
            {mode === 'wearing' ? t.scan.wearingHint : t.scan.hint}
          </Txt>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 12 }}>
          <Chip dark small label={t.scan.modeFlat} active={mode === 'flat'} onPress={() => setMode('flat')} />
          <Chip
            dark
            small
            label={t.scan.modeWearing}
            active={mode === 'wearing'}
            onPress={() => {
              setMode('wearing');
              setFacing('front');
            }}
          />
        </View>

        {imagesLeft !== null ? (
          imagesLeft > 0 ? (
            <Pressable
              onPress={() => {
                setStudio(!studio);
                setStudioAtCapture(!studio);
                void haptic('light');
              }}
              style={styles.studioRow}
              accessibilityRole="switch"
              accessibilityState={{ checked: studioOn }}
            >
              <View style={[styles.studioBox, studioOn && styles.studioBoxOn]}>{studioOn ? <Check size={12} color={colors.charcoal} /> : null}</View>
              <Txt style={styles.studioLabel}>{t.scan.studioAtCapture(imagesLeft)}</Txt>
            </Pressable>
          ) : (
            <View style={[styles.studioRow, { opacity: 0.85 }]} accessibilityState={{ disabled: true }}>
              <Wand2 size={14} color="rgba(255,255,255,0.5)" />
              <Txt style={[styles.studioLabel, { color: 'rgba(255,255,255,0.55)' }]}>
                {t.scan.studioNoneLeft}{' '}
                <Txt style={[styles.studioLabel, { color: colors.gold, textDecorationLine: 'underline' }]} accessibilityRole="link" onPress={() => router.push('/paywall')}>
                  {t.spend.seePlans}
                </Txt>
              </Txt>
            </View>
          )
        ) : null}

        {added.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }} style={{ marginTop: 14, flexGrow: 0 }}>
            {added.map((item) => (
              <Image key={item.id} source={{ uri: item.uri }} style={styles.thumb} contentFit="cover" />
            ))}
          </ScrollView>
        ) : null}
        {added.length > 0 ? (
          <Txt
            style={{ color: colors.gold, fontSize: 11, textAlign: 'center', marginTop: 8 }}
            onPress={aiConsent ? undefined : () => void ensureAiConsent()}
            accessibilityRole={aiConsent ? undefined : 'button'}
          >
            {added.length} · {aiConsent ? t.scan.added : t.scan.addedWaiting}
          </Txt>
        ) : null}
        {studioNote ? <Txt style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, textAlign: 'center', marginTop: 4, marginHorizontal: 24 }}>{studioNote}</Txt> : null}

        <View style={styles.controls}>
          <Pressable onPress={() => void pickFromGallery()} style={styles.sideButton} accessibilityLabel={t.scan.gallery}>
            <ImageIcon size={20} color={colors.white} />
            <Txt style={styles.sideLabel}>{t.scan.gallery}</Txt>
          </Pressable>
          <Pressable onPress={() => void capture()} disabled={busy} style={({ pressed }) => [styles.shutter, { transform: [{ scale: pressed ? 0.94 : 1 }] }]}>
            {busy ? <ActivityIndicator color={colors.charcoal} /> : <View style={styles.shutterInner} />}
          </Pressable>
          <Pressable
            onPress={() => {
              if (added.length === 0) return router.back();
              router.replace('/wardrobe');
            }}
            style={styles.sideButton}
            accessibilityLabel={t.common.done}
          >
            <Check size={20} color={added.length ? colors.gold : colors.white} />
            <Txt style={styles.sideLabel}>{t.common.done}</Txt>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function cornerStyle(corner: string) {
  const size = { width: 28, height: 28 };
  const border = 3;
  switch (corner) {
    case 'tl':
      return { ...size, top: 0, left: 0, borderTopWidth: border, borderLeftWidth: border, borderTopLeftRadius: 16 };
    case 'tr':
      return { ...size, top: 0, right: 0, borderTopWidth: border, borderRightWidth: border, borderTopRightRadius: 16 };
    case 'bl':
      return { ...size, bottom: 0, left: 0, borderBottomWidth: border, borderLeftWidth: border, borderBottomLeftRadius: 16 };
    default:
      return { ...size, bottom: 0, right: 0, borderBottomWidth: border, borderRightWidth: border, borderBottomRightRadius: 16 };
  }
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center', padding: 32 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  frame: { width: '78%', aspectRatio: 3 / 4, marginTop: -60 },
  corner: { position: 'absolute', borderColor: colors.gold },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 16, backgroundColor: 'rgba(0,0,0,0.45)' },
  hint: { marginHorizontal: 24, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md, backgroundColor: 'rgba(0,0,0,0.35)' },
  studioRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12, marginHorizontal: 24, paddingVertical: 6 },
  studioBox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center' },
  studioBoxOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  studioLabel: { color: colors.white, fontSize: 12, fontFamily: fonts.sansMedium },
  thumb: { width: 48, height: 64, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginTop: 16 },
  sideButton: { width: 72, alignItems: 'center', gap: 4 },
  sideLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 11 },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.white },
});
