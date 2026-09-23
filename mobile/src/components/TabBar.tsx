import { Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Camera, Compass, Layers, User } from 'lucide-react-native';
import { BRAND } from '@/lib/brand';
import { openWithAccount, useStrings } from '@/lib/store';
import { colors, fonts } from '@/lib/theme';
import { MarkGlyph } from './brand';
import { haptic, Txt } from './ui';

const LINE_ICONS = { index: Compass, looks: Layers, profile: User } as const;
const TABS = ['index', 'wardrobe', 'looks', 'profile'];

/** The wardrobe tab wears the Mirobe mark; the others are line icons. */
function TabIcon({ name, color, focused }: { name: string; color: string; focused: boolean }) {
  if (name === 'wardrobe') return <MarkGlyph height={24} color={color} accent={focused ? BRAND.gold : color} />;
  const Icon = LINE_ICONS[name as keyof typeof LINE_ICONS];
  return <Icon size={21} strokeWidth={1.6} color={color} />;
}

/**
 * Port of the web BottomTabBar: four tabs plus a raised mirror button in the
 * middle that opens the full-screen mirror instead of switching tabs.
 */
export function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  const t = useStrings();
  const labels: Record<string, string> = {
    index: t.tabs.home,
    wardrobe: t.tabs.wardrobe,
    looks: t.tabs.looks,
    profile: t.tabs.profile,
  };
  const routes = state.routes.filter((route) => TABS.includes(route.name));
  const left = routes.slice(0, 2);
  const right = routes.slice(2);

  const renderTab = (route: (typeof routes)[number]) => {
    const focused = state.routes[state.index]?.key === route.key;
    const color = focused ? colors.charcoal : colors.mutedGray;
    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        onPress={() => {
          void haptic('light');
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        }}
        style={styles.tab}
      >
        <View style={styles.icon}>
          <TabIcon name={route.name} color={color} focused={focused} />
        </View>
        <Txt style={[styles.label, { color, fontFamily: focused ? fonts.sansSemi : fonts.sansMedium }]}>{labels[route.name]}</Txt>
      </Pressable>
    );
  };

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {/* Blur is clipped on its own layer so the raised mirror button can overflow the bar. */}
      <View pointerEvents="none" style={styles.backdrop}>
        <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFill} />
      </View>
      <View style={styles.row}>
        {left.map(renderTab)}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.tabs.mirror}
          onPress={() => {
            void haptic('medium');
            // Anonymous: straight to sign in; the camera opens only afterwards.
            openWithAccount('/mirror');
          }}
          style={styles.mirrorTab}
        >
          {({ pressed }) => (
            <>
              <View style={[styles.mirrorButton, { transform: [{ scale: pressed ? 0.94 : 1 }] }]}>
                <Camera size={20} strokeWidth={1.9} color={colors.ivory} />
                <View style={styles.liveDot} />
              </View>
              <Txt style={[styles.label, { color: colors.charcoal, fontFamily: fonts.sansSemi }]}>{t.tabs.mirror}</Txt>
            </>
          )}
        </Pressable>
        {right.map(renderTab)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 8,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
    backgroundColor: 'rgba(251,249,245,0.96)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', paddingHorizontal: 8 },
  tab: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 4 },
  icon: { height: 24, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 10, letterSpacing: 0.3 },
  mirrorTab: { alignItems: 'center', gap: 3, marginTop: -18, paddingHorizontal: 6 },
  mirrorButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.charcoal,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
    borderWidth: 3,
    borderColor: colors.ivory,
  },
  liveDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.emerald,
    borderWidth: 1.5,
    borderColor: colors.charcoal,
  },
});
