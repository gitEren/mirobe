import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { Camera, Play, UserRound } from 'lucide-react-native';
import type { TryOnRow } from '@mirobe/shared';
import { mediaUrl } from '@/lib/api';
import { useStrings } from '@/lib/store';
import { colors, fonts, radius } from '@/lib/theme';
import { Txt } from './ui';

/** "5 dk önce" style labels. Hermes has no Intl.RelativeTimeFormat, so this is hand-rolled. */
export function relativeTime(iso: string, lang: 'tr' | 'en') {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  const tr = lang === 'tr';
  if (minutes < 1) return tr ? 'şimdi' : 'just now';
  if (minutes < 60) return tr ? `${minutes} dk önce` : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return tr ? `${hours} saat önce` : `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return tr ? 'dün' : 'yesterday';
  return tr ? `${days} gün önce` : `${days} days ago`;
}

/** A try-on dressed a just-taken camera frame rather than the saved mirror photo. */
export const isLivePhoto = (tryon: TryOnRow) => tryon.avatarId === null;

/** An AI try-on result: the dressed photo, where it came from, and a badge when its motion clip exists. */
export function TryOnThumb({
  tryon,
  width,
  style,
  selected,
  onPress,
}: {
  tryon: TryOnRow;
  width?: number;
  style?: object;
  selected?: boolean;
  onPress?: () => void;
}) {
  const t = useStrings();
  const live = isLivePhoto(tryon);
  return (
    <Pressable
      onPress={onPress ?? (() => router.push({ pathname: '/tryon/[id]', params: { id: tryon.id } }))}
      style={({ pressed }) => [styles.card, width ? { width } : { flex: 1 }, style, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}
    >
      <Image source={{ uri: mediaUrl(tryon.imageUrl) }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" transition={200} recyclingKey={tryon.id} />
      <View style={styles.source}>
        {live ? <Camera size={9} color={colors.white} /> : <UserRound size={9} color={colors.white} />}
        <Txt style={styles.badgeText}>{live ? t.tryons.fromCamera : t.tryons.fromMirror}</Txt>
      </View>
      {selected ? <View pointerEvents="none" style={styles.selected} /> : null}
      {tryon.videoStatus === 'ready' ? (
        <View style={styles.badge}>
          <Play size={10} color={colors.white} fill={colors.white} />
          <Txt style={styles.badgeText}>{t.tryons.videoBadge}</Txt>
        </View>
      ) : tryon.videoStatus === 'processing' ? (
        <View style={styles.badge}>
          <ActivityIndicator size="small" color={colors.gold} style={{ transform: [{ scale: 0.6 }] }} />
          <Txt style={styles.badgeText}>{t.tryons.videoBusy}</Txt>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { aspectRatio: 9 / 16, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.stone },
  badge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  badgeText: { color: colors.white, fontSize: 10, fontFamily: fonts.sansSemi },
  source: {
    position: 'absolute',
    left: 6,
    top: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  selected: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.lg, borderWidth: 2.5, borderColor: colors.charcoal },
});
