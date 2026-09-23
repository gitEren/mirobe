import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus, Search } from 'lucide-react-native';
import { GARMENT_CATEGORIES, labelFor, type GarmentCategory } from '@mirobe/shared';
import { GarmentCard } from '@/components/garment';
import { EmptyWardrobe } from '@/components/home';
import { StatusBarScrim, TAB_BAR_SPACE } from '@/components/Screen';
import { Chip, Txt, haptic } from '@/components/ui';
import { openWithAccount, syncNow, useStore, useStrings } from '@/lib/store';
import { colors, fonts, radius } from '@/lib/theme';

export default function Wardrobe() {
  const t = useStrings();
  const lang = useStore((s) => s.lang);
  const garments = useStore((s) => s.garments);
  const syncing = useStore((s) => s.syncing);
  const insets = useSafeAreaInsets();
  const [category, setCategory] = useState<GarmentCategory | 'all'>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(lang);
    return garments.filter((g) => {
      if (category !== 'all' && g.category !== category) return false;
      if (!q) return true;
      const haystack = [
        g.name,
        g.subcategory,
        g.material,
        ...g.colors.map((c) => c.name),
        ...g.extraTags,
        ...[...g.styleTags, ...g.occasions, g.pattern].map((tag) => labelFor(tag, lang)),
      ]
        .join(' ')
        .toLocaleLowerCase(lang);
      return haystack.includes(q);
    });
  }, [garments, category, query, lang]);

  const categories = GARMENT_CATEGORIES.filter((c) => garments.some((g) => g.category === c));

  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <FlatList
        data={filtered}
        keyExtractor={(g) => g.id}
        numColumns={2}
        style={{ flex: 1, backgroundColor: colors.ivory }}
        columnWrapperStyle={{ gap: 12 }}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: TAB_BAR_SPACE + insets.bottom, gap: 12 }}
        refreshing={syncing}
        onRefresh={() => void syncNow()}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
              <View>
                <Txt variant="title">{t.wardrobe.title}</Txt>
                <Txt variant="caption">{t.wardrobe.count(garments.length)}</Txt>
              </View>
              <Pressable
                onPress={() => {
                  void haptic('medium');
                  openWithAccount('/scan');
                }}
                style={styles.addButton}
              >
                <Plus size={16} color={colors.ivory} />
                <Txt style={{ color: colors.ivory, fontFamily: fonts.sansSemi, fontSize: 12 }}>{t.wardrobe.add}</Txt>
              </Pressable>
            </View>
            <View style={styles.search}>
              <Search size={16} color={colors.warmGray} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t.wardrobe.search}
                placeholderTextColor={colors.mutedGray}
                style={styles.searchInput}
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
            </View>
            <FlatList
              horizontal
              data={['all', ...categories] as const}
              keyExtractor={(c) => c}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
              renderItem={({ item }) => (
                <Chip
                  label={item === 'all' ? t.wardrobe.all : labelFor(item, lang)}
                  active={category === item}
                  onPress={() => setCategory(item)}
                />
              )}
            />
          </View>
        }
        ListEmptyComponent={
          garments.length === 0 ? (
            <EmptyWardrobe />
          ) : (
            <View style={{ paddingVertical: 48, alignItems: 'center' }}>
              <Txt variant="caption">{t.wardrobe.empty}</Txt>
            </View>
          )
        }
        renderItem={({ item, index }) => (
          <View style={{ flex: 1, maxWidth: filtered.length % 2 === 1 && index === filtered.length - 1 ? '48.5%' : undefined }}>
            <GarmentCard garment={item} onPress={() => router.push({ pathname: '/garment/[id]', params: { id: item.id } })} />
          </View>
        )}
      />
      <StatusBarScrim height={insets.top} />
    </View>
  );
}

const styles = StyleSheet.create({
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.charcoal,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.stone,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, fontFamily: fonts.sans, fontSize: 14, color: colors.charcoal },
});
