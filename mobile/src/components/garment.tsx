import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { AlertCircle, Clock, Heart, Lock } from 'lucide-react-native';
import { labelFor, type GarmentRow } from '@mirobe/shared';
import { mediaUrl } from '@/lib/api';
import { useStore, useStrings } from '@/lib/store';
import { colors, fonts, radius } from '@/lib/theme';
import { Txt } from './ui';

/** AI packshot, then the on-device cutout, then the raw photo. */
export function garmentImage(garment: GarmentRow) {
  return mediaUrl(garment.packshotUrl ?? garment.cutoutUrl ?? garment.imageUrl);
}

/** Cutouts and packshots are isolated products and should never be cropped. */
export function isIsolated(garment: GarmentRow) {
  return Boolean(garment.packshotUrl || garment.cutoutUrl);
}

export function GarmentImage({ garment, style, padded = true }: { garment: GarmentRow; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  // Spins only while a tagging request is actually running (here, or claimed on the server).
  // A pending piece waits: for sign-in when anonymous, for consent to AI processing, or for
  // the next sync to pick it up.
  const analyzing = useStore((s) => s.analyzing.includes(garment.id)) || garment.taggingStatus === 'processing';
  const blocked = useStore((s) => s.isAnonymous || !s.aiConsent);
  return (
    <View style={[styles.imageBox, style]}>
      <Image
        source={{ uri: garmentImage(garment) }}
        style={[StyleSheet.absoluteFill, padded && isIsolated(garment) ? { margin: 10 } : null]}
        contentFit={isIsolated(garment) ? 'contain' : 'cover'}
        transition={250}
        recyclingKey={garment.id}
      />
      {analyzing ? (
        <View style={styles.statusPill}>
          <ActivityIndicator size="small" color={colors.gold} />
        </View>
      ) : garment.taggingStatus === 'pending' ? (
        <View style={[styles.statusPill, { backgroundColor: 'rgba(255,255,255,0.8)' }]}>
          {blocked ? <Lock size={11} color={colors.charcoal} /> : <Clock size={11} color={colors.charcoal} />}
        </View>
      ) : garment.taggingStatus === 'failed' ? (
        <View style={[styles.statusPill, { backgroundColor: 'rgba(180,65,60,0.85)' }]}>
          <AlertCircle size={12} color="#fff" />
        </View>
      ) : garment.favorite ? (
        <View style={[styles.statusPill, { backgroundColor: 'rgba(255,255,255,0.8)' }]}>
          <Heart size={11} color={colors.charcoal} fill={colors.charcoal} />
        </View>
      ) : null}
    </View>
  );
}

export function GarmentCard({
  garment,
  onPress,
  selected,
  width,
}: {
  garment: GarmentRow;
  onPress?: () => void;
  selected?: boolean;
  width?: number;
}) {
  const t = useStrings();
  const lang = useStore((s) => s.lang);
  const isAnonymous = useStore((s) => s.isAnonymous);
  const aiConsent = useStore((s) => s.aiConsent);
  const status =
    garment.taggingStatus === 'failed'
      ? t.wardrobe.failed
      : garment.taggingStatus === 'pending' && isAnonymous
        ? t.wardrobe.signInToTag
        : garment.taggingStatus === 'pending' && !aiConsent
          ? t.wardrobe.allowToTag
          : garment.taggingStatus !== 'ready'
            ? t.wardrobe.analyzing
            : garment.category
              ? labelFor(garment.category, lang)
              : '';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        width ? { width } : { flex: 1 },
        selected && { borderColor: colors.charcoal, borderWidth: 1.5 },
        { transform: [{ scale: pressed ? 0.98 : 1 }] },
      ]}
    >
      <GarmentImage garment={garment} style={{ aspectRatio: 3 / 4 }} />
      <View style={{ paddingHorizontal: 4, paddingTop: 8, paddingBottom: 2 }}>
        <Txt variant="bodyStrong" numberOfLines={1} style={{ fontSize: 13 }}>
          {garment.name || '—'}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
          {garment.colors.slice(0, 3).map((c) => (
            <View key={c.hex + c.name} style={[styles.swatch, { backgroundColor: c.hex }]} />
          ))}
          <Txt variant="tiny" numberOfLines={1} style={{ textTransform: 'uppercase', letterSpacing: 0.8, flexShrink: 1 }}>
            {status}
          </Txt>
        </View>
      </View>
    </Pressable>
  );
}

export function TagList({ tags, lang }: { tags: string[]; lang: 'tr' | 'en' }) {
  if (tags.length === 0) return <Txt variant="caption">—</Txt>;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {tags.map((tag) => (
        <View key={tag} style={styles.tag}>
          <Txt style={{ fontFamily: fonts.sansMedium, fontSize: 12 }}>{labelFor(tag, lang)}</Txt>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 8,
    borderRadius: radius.lg,
    backgroundColor: colors.stone,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  imageBox: {
    width: '100%',
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.stoneCard,
  },
  statusPill: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(26,25,24,0.78)',
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.2)',
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.ivory,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
});
