import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { upper } from '@/lib/i18n';
import { useStore } from '@/lib/store';
import { colors, fonts, radius } from '@/lib/theme';

type TextVariant = 'display' | 'title' | 'serif' | 'label' | 'body' | 'bodyStrong' | 'caption' | 'tiny';

const textStyles: Record<TextVariant, TextStyle> = {
  display: { fontFamily: fonts.serif, fontSize: 38, lineHeight: 42, color: colors.charcoal, letterSpacing: -0.5 },
  title: { fontFamily: fonts.serif, fontSize: 28, lineHeight: 32, color: colors.charcoal, letterSpacing: -0.3 },
  serif: { fontFamily: fonts.serifItalic, fontSize: 14, color: colors.mutedGray },
  label: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.warmGray,
  },
  body: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 20, color: colors.charcoal },
  bodyStrong: { fontFamily: fonts.sansSemi, fontSize: 14, lineHeight: 20, color: colors.charcoal },
  caption: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 16, color: colors.warmGray },
  tiny: { fontFamily: fonts.sansMedium, fontSize: 10, lineHeight: 13, color: colors.warmGray },
};

export function Txt({
  variant = 'body',
  style,
  children,
  ...rest
}: ComponentProps<typeof Text> & { variant?: TextVariant }) {
  const lang = useStore((s) => s.lang);
  const merged = [textStyles[variant], style];
  // The platform upper-cases with English rules ("SENIN"); do it here so Turkish gets "SENİN".
  if (lang === 'tr' && StyleSheet.flatten(merged).textTransform === 'uppercase') {
    const upperChildren = Array.isArray(children)
      ? children.map((child) => (typeof child === 'string' ? upper(child, lang) : child))
      : typeof children === 'string'
        ? upper(children, lang)
        : children;
    return (
      <Text {...rest} style={[...merged, { textTransform: 'none' }]}>
        {upperChildren}
      </Text>
    );
  }
  return (
    <Text {...rest} style={merged}>
      {children}
    </Text>
  );
}

export function haptic(kind: 'light' | 'medium' | 'success' | 'warning' = 'light') {
  if (kind === 'success') return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  if (kind === 'warning') return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  return Haptics.impactAsync(kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
}

type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'light' | 'gold' | 'glass' | 'danger';

const buttonTones: Record<ButtonTone, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.charcoal, fg: colors.ivory },
  secondary: { bg: colors.stone, fg: colors.charcoal, border: colors.border },
  ghost: { bg: 'transparent', fg: colors.charcoal, border: colors.border },
  light: { bg: colors.ivory, fg: '#171411' },
  gold: { bg: colors.amber, fg: '#171411' },
  glass: { bg: colors.glass, fg: colors.white, border: colors.glassBorder },
  danger: { bg: colors.danger, fg: colors.ivory },
};

export function Button({
  title,
  onPress,
  tone = 'primary',
  icon,
  loading,
  disabled,
  size = 'md',
  style,
}: {
  title: string;
  onPress?: () => void;
  tone?: ButtonTone;
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
}) {
  const t = buttonTones[tone];
  const height = size === 'sm' ? 34 : size === 'lg' ? 54 : 44;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={() => {
        void haptic('light');
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.button,
        {
          height,
          paddingHorizontal: size === 'sm' ? 14 : 20,
          backgroundColor: t.bg,
          borderColor: t.border ?? t.bg,
          opacity: disabled ? 0.45 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={t.fg} size="small" /> : icon}
      <Text style={[styles.buttonText, { color: t.fg, fontSize: size === 'sm' ? 12 : 14 }]} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
}

export function IconButton({
  children,
  onPress,
  tone = 'glass',
  size = 38,
  accessibilityLabel,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  tone?: 'glass' | 'stone' | 'charcoal';
  size?: number;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}) {
  const bg = tone === 'glass' ? colors.glass : tone === 'stone' ? colors.stone : colors.charcoal;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      onPress={() => {
        void haptic('light');
        onPress?.();
      }}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: bg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: tone === 'glass' ? colors.glassBorder : colors.border,
          transform: [{ scale: pressed ? 0.93 : 1 }],
        },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

export function Chip({
  label,
  active,
  onPress,
  dark,
  small,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  dark?: boolean;
  small?: boolean;
}) {
  const bg = dark ? (active ? colors.white : 'rgba(0,0,0,0.35)') : active ? colors.charcoal : colors.stone;
  const fg = dark ? (active ? '#000' : 'rgba(255,255,255,0.7)') : active ? colors.ivory : colors.charcoal;
  return (
    <Pressable
      disabled={!onPress}
      onPress={() => {
        void haptic('light');
        onPress?.();
      }}
      style={{
        paddingHorizontal: small ? 10 : 14,
        paddingVertical: small ? 5 : 8,
        borderRadius: radius.pill,
        backgroundColor: bg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: dark ? colors.glassBorder : active ? colors.charcoal : colors.border,
      }}
    >
      <Text style={{ fontFamily: fonts.sansMedium, fontSize: small ? 11 : 12, color: fg }}>{label}</Text>
    </Pressable>
  );
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Txt variant="label">{title}</Txt>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Txt variant="caption" style={{ color: colors.charcoal }}>
            {action}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Banner({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'warning' }) {
  return (
    <View
      style={{
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: radius.md,
        backgroundColor: tone === 'warning' ? '#F7EBD3' : colors.stone,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: tone === 'warning' ? '#E9D2A4' : colors.border,
      }}
    >
      <Txt variant="caption" style={{ color: tone === 'warning' ? '#6B4E16' : colors.warmGray }}>
        {text}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttonText: { fontFamily: fonts.sansSemi, letterSpacing: 0.2 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
});
