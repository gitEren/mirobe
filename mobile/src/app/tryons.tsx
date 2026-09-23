import { useMemo } from 'react';
import { FlatList, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { TryOnThumb } from '@/components/tryon';
import { IconButton, Txt } from '@/components/ui';
import { useStore, useStrings } from '@/lib/store';
import { colors } from '@/lib/theme';

/** Every AI try-on result, most recently used first. */
export default function TryOns() {
  const t = useStrings();
  const insets = useSafeAreaInsets();
  // Select the stable array and derive from it; a selector returning a new array loops forever.
  const all = useStore((s) => s.tryons);
  const tryons = useMemo(() => all.filter((tr) => tr.status === 'ready' && tr.imageUrl), [all]);

  return (
    <FlatList
      data={tryons}
      keyExtractor={(tr) => tr.id}
      numColumns={2}
      style={{ flex: 1, backgroundColor: colors.ivory }}
      columnWrapperStyle={{ gap: 12 }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: insets.bottom + 24, gap: 12 }}
      ListHeaderComponent={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <IconButton accessibilityLabel={t.common.close} tone="stone" onPress={() => router.back()}>
            <ChevronLeft size={20} color={colors.charcoal} />
          </IconButton>
          <View>
            <Txt variant="title">{t.tryons.title}</Txt>
            <Txt variant="caption">{t.tryons.count(tryons.length)}</Txt>
          </View>
        </View>
      }
      ListEmptyComponent={
        <Txt variant="caption" style={{ textAlign: 'center', marginTop: 48 }}>
          {t.tryons.empty}
        </Txt>
      }
      renderItem={({ item, index }) => (
        <View style={{ flex: 1, maxWidth: tryons.length % 2 === 1 && index === tryons.length - 1 ? '48.5%' : undefined }}>
          <TryOnThumb tryon={item} />
        </View>
      )}
    />
  );
}
