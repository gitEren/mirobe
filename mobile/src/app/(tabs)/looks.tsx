import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Sparkles } from 'lucide-react-native';
import { labelFor } from '@mirobe/shared';
import { LookCover } from '@/components/look';
import { StatusBarScrim, TAB_BAR_SPACE } from '@/components/Screen';
import { TryOnThumb } from '@/components/tryon';
import { Button, Chip, SectionHeader, Txt } from '@/components/ui';
import { openWithAccount, syncNow, useStore, useStrings } from '@/lib/store';
import { colors, fonts, radius } from '@/lib/theme';

export default function Looks() {
  const t = useStrings();
  const lang = useStore((s) => s.lang);
  const looks = useStore((s) => s.looks);
  const tryons = useStore((s) => s.tryons);
  const recent = useMemo(() => tryons.filter((tr) => tr.status === 'ready' && tr.imageUrl).slice(0, 12), [tryons]);
  const syncing = useStore((s) => s.syncing);
  const insets = useSafeAreaInsets();
  const [occasion, setOccasion] = useState<string>('all');
  const occasions = useMemo(() => [...new Set(looks.map((l) => l.occasion).filter(Boolean))], [looks]);
  const filtered = occasion === 'all' ? looks : looks.filter((l) => l.occasion === occasion);

  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <FlatList
        data={filtered}
        keyExtractor={(l) => l.id}
        numColumns={2}
        style={{ flex: 1, backgroundColor: colors.ivory }}
        columnWrapperStyle={{ gap: 12 }}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: TAB_BAR_SPACE + insets.bottom, gap: 12 }}
        refreshing={syncing}
        onRefresh={() => void syncNow()}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 4 }}>
            <View>
              <Txt variant="title">{t.looks.title}</Txt>
              <Txt variant="caption">{t.looks.count(looks.length)}</Txt>
            </View>
            {recent.length > 0 ? (
            <View style={{ marginTop: 6 }}>
              <SectionHeader title={t.tryons.recent} action={t.common.seeAll} onAction={() => router.push('/tryons')} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}>
                {recent.map((tryon) => (
                  <TryOnThumb key={tryon.id} tryon={tryon} width={118} />
                ))}
              </ScrollView>
            </View>
          ) : null}
          {looks.length > 0 ? <SectionHeader title={t.looks.saved} /> : null}
          {occasions.length > 0 ? (
              <FlatList
                horizontal
                data={['all', ...occasions]}
                keyExtractor={(o) => o}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}
                renderItem={({ item }) => (
                  <Chip
                    label={item === 'all' ? t.wardrobe.all : labelFor(item, lang)}
                    active={occasion === item}
                    onPress={() => setOccasion(item)}
                  />
                )}
              />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={{ paddingVertical: 48, alignItems: 'center', gap: 16 }}>
            <Txt variant="caption" style={{ textAlign: 'center' }}>
              {t.looks.empty}
            </Txt>
            <Button title={t.home.askJev} icon={<Sparkles size={15} color={colors.amber} />} onPress={() => openWithAccount('/stylist')} />
          </View>
        }
        renderItem={({ item, index }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/look/[id]', params: { id: item.id } })}
            style={[styles.card, filtered.length % 2 === 1 && index === filtered.length - 1 && { maxWidth: '48.5%' }]}
          >
            <View style={styles.cover}>
              <LookCover look={item} />
              <LinearGradient colors={['transparent', 'rgba(0,0,0,0.55)']} style={StyleSheet.absoluteFill} />
              {item.occasion ? (
                <View style={styles.badge}>
                  <Txt
                    style={{ color: colors.white, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', fontFamily: fonts.sansSemi }}
                  >
                    {labelFor(item.occasion, lang)}
                  </Txt>
                </View>
              ) : null}
            </View>
            <View style={{ padding: 10 }}>
              <Txt variant="bodyStrong" numberOfLines={1} style={{ fontSize: 13 }}>
                {item.title}
              </Txt>
              <Txt variant="tiny">{t.common.pieces(item.garmentIds.length)}</Txt>
            </View>
          </Pressable>
        )}
      />
      <StatusBarScrim height={insets.top} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.stone,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cover: { aspectRatio: 3 / 4, backgroundColor: colors.stoneCard },
  badge: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
});
