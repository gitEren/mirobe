import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';

export const TAB_BAR_SPACE = 96;

export function Screen({
  children,
  scroll = true,
  withTabBar = true,
  onRefresh,
  refreshing = false,
  contentStyle,
}: {
  children: ReactNode;
  scroll?: boolean;
  withTabBar?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const padding = { paddingTop: insets.top + 8, paddingBottom: (withTabBar ? TAB_BAR_SPACE : 24) + insets.bottom, paddingHorizontal: 20 };
  if (!scroll) return <View style={[{ flex: 1, backgroundColor: colors.ivory }, padding, contentStyle]}>{children}</View>;
  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.ivory }}
        contentContainerStyle={[padding, contentStyle]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.warmGray} /> : undefined
        }
      >
        {children}
      </ScrollView>
      <StatusBarScrim height={insets.top} />
    </View>
  );
}

/** Keeps scrolled content from running under the status bar / Dynamic Island. */
export function StatusBarScrim({ height }: { height: number }) {
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, height, backgroundColor: 'rgba(251,249,245,0.94)' }}
    />
  );
}
