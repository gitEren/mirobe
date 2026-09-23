import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import { AccountGate } from '@/components/AccountGate';
import { CameraSurface, type CameraSurfaceHandle } from '@/components/CameraSurface';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ImageIcon, Timer, X } from 'lucide-react-native';
import { Button, IconButton, Txt, haptic } from '@/components/ui';
import { persistPhoto } from '@/lib/media';
import { upper } from '@/lib/i18n';
import { setAvatar, useStore, useStrings } from '@/lib/store';
import { colors, fonts, radius } from '@/lib/theme';

const COUNTDOWN = 3;

/** Anonymous visitors sign in first: the camera never opens for them. */
export default function AvatarScreen() {
  return (
    <AccountGate route="/avatar" dark>
      <Avatar />
    </AccountGate>
  );
}

function Avatar() {
  const t = useStrings();
  const lang = useStore((s) => s.lang);
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraSurfaceHandle>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [photo, setPhoto] = useState<{ uri: string; width: number; height: number } | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Leaving mid-countdown must not fire the shutter on an unmounted camera.
  useEffect(
    () => () => {
      if (countdownTimer.current) clearInterval(countdownTimer.current);
    },
    []
  );

  const capture = () => {
    if (countdown !== null || countdownTimer.current) return;
    let left = COUNTDOWN;
    setCountdown(left);
    countdownTimer.current = setInterval(async () => {
      left -= 1;
      if (left > 0) {
        void haptic('light');
        setCountdown(left);
        return;
      }
      if (countdownTimer.current) clearInterval(countdownTimer.current);
      countdownTimer.current = null;
      setCountdown(null);
      const shot = await camera.current?.takePictureAsync({ quality: 0.9 });
      if (shot) setPhoto({ uri: shot.uri, width: shot.width, height: shot.height });
    }, 1000);
  };

  const pick = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (!result.canceled) {
      const asset = result.assets[0];
      setPhoto({ uri: asset.uri, width: asset.width, height: asset.height });
    }
  };

  const use = async () => {
    if (!photo) return;
    setSaving(true);
    try {
      const stored = await persistPhoto(photo.uri, photo);
      setAvatar(stored);
      void haptic('success');
      router.back();
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.night }}>
      {photo ? (
        <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : permission?.granted ? (
        <CameraSurface ref={camera} style={StyleSheet.absoluteFill} facing="front" />
      ) : null}

      {!photo && permission?.granted ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <View style={styles.silhouette} />
          {countdown !== null ? (
            <Txt style={{ position: 'absolute', color: colors.white, fontFamily: fonts.serif, fontSize: 120 }}>{countdown}</Txt>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <IconButton accessibilityLabel={t.common.close} onPress={() => router.back()}>
          <X size={18} color={colors.white} />
        </IconButton>
        <Txt style={{ color: colors.white, fontFamily: fonts.sansSemi, letterSpacing: 2, fontSize: 12 }}>{upper(t.avatar.title, lang)}</Txt>
        <View style={{ width: 38 }} />
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
        {!permission?.granted && !photo ? (
          <View style={{ gap: 10 }}>
            <Txt style={{ color: colors.white, textAlign: 'center' }}>{t.scan.permission}</Txt>
            <Button title={t.scan.grant} tone="light" onPress={() => void requestPermission()} />
            <Button title={t.avatar.fromGallery} tone="glass" onPress={() => void pick()} />
          </View>
        ) : photo ? (
          <View style={{ gap: 10 }}>
            <Button title={t.avatar.use} tone="light" size="lg" loading={saving} onPress={() => void use()} />
            <Button title={t.avatar.retake} tone="glass" onPress={() => setPhoto(null)} />
          </View>
        ) : (
          <>
            <View style={styles.hint}>
              <Txt style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, textAlign: 'center', lineHeight: 17 }}>{t.avatar.body}</Txt>
            </View>
            <View style={styles.controls}>
              <Pressable onPress={() => void pick()} style={styles.side}>
                <ImageIcon size={20} color={colors.white} />
                <Txt style={styles.sideLabel}>{t.scan.gallery}</Txt>
              </Pressable>
              <Pressable onPress={capture} style={styles.shutter}>
                {countdown !== null ? <ActivityIndicator color={colors.charcoal} /> : <Timer size={26} color={colors.charcoal} />}
              </Pressable>
              <View style={styles.side}>
                <Txt style={styles.sideLabel}>{COUNTDOWN} sn</Txt>
              </View>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  silhouette: {
    width: '58%',
    height: '72%',
    borderRadius: 200,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,215,106,0.6)',
    marginTop: -40,
  },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 16, backgroundColor: 'rgba(0,0,0,0.45)' },
  hint: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md, backgroundColor: 'rgba(0,0,0,0.35)' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginTop: 16 },
  side: { width: 72, alignItems: 'center', gap: 4 },
  sideLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 11 },
  shutter: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
});
