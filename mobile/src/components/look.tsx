import { StyleSheet, View, type DimensionValue } from 'react-native';
import { Image } from 'expo-image';
import type { GarmentRow, LookRow } from '@mirobe/shared';
import { mediaUrl } from '@/lib/api';
import { useStore } from '@/lib/store';
import { colors, radius } from '@/lib/theme';
import { garmentImage, isIsolated } from './garment';

const ORDER = ['outerwear', 'dress', 'top', 'bottom', 'shoes', 'accessory'];

/**
 * Flat-lay of the outfit's own pieces (no AI image): one hero piece and the
 * rest stacked beside it, each on its own card like a styled product shot.
 */
export function OutfitCollage({ garmentIds, padding = 10 }: { garmentIds: string[]; padding?: number }) {
  const garments = useStore((s) => s.garments);
  const items = garmentIds
    .map((id) => garments.find((g) => g.id === id))
    .filter((g): g is GarmentRow => g !== undefined)
    .sort((a, b) => ORDER.indexOf(a.category ?? '') - ORDER.indexOf(b.category ?? ''))
    .slice(0, 5);
  if (items.length === 0) return <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.stoneCard }]} />;

  const [hero, ...rest] = items;
  return (
    <View style={[StyleSheet.absoluteFill, styles.collage, { padding, gap: padding }]}>
      <Tile garment={hero} width={rest.length ? '58%' : '100%'} height="100%" />
      {rest.length ? (
        <View style={{ flex: 1, gap: padding }}>
          {rest.map((garment) => (
            <Tile key={garment.id} garment={garment} width="100%" height={`${100 / rest.length}%`} flexible />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Tile({ garment, width, height, flexible }: { garment: GarmentRow; width: DimensionValue; height: DimensionValue; flexible?: boolean }) {
  const isolated = isIsolated(garment);
  return (
    <View style={[styles.tile, flexible ? { flex: 1 } : { width, height }]}>
      <Image
        source={{ uri: garmentImage(garment) }}
        style={[StyleSheet.absoluteFill, isolated && { margin: 8 }]}
        contentFit={isolated ? 'contain' : 'cover'}
        transition={200}
        recyclingKey={garment.id}
      />
    </View>
  );
}

/** Saved looks: the try-on photo when one exists, otherwise the pieces as a flat-lay. */
export function LookCover({ look }: { look: LookRow }) {
  const tryon = useStore((s) => s.tryons.find((t) => t.id === look.tryonId && t.imageUrl));
  const cover = mediaUrl(tryon?.imageUrl ?? look.coverUrl);
  if (cover) return <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" transition={250} />;
  return <OutfitCollage garmentIds={look.garmentIds} padding={6} />;
}

const styles = StyleSheet.create({
  collage: { flexDirection: 'row', backgroundColor: colors.stone },
  tile: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.stoneCard },
});
