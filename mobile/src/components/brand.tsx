import { useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { BRAND, GLYPH, MARK, MARK_RATIO, sparklePath } from '@/lib/brand';
import { useStrings } from '@/lib/store';
import { colors, fonts } from '@/lib/theme';
import { Txt } from './ui';

const VIEWBOX = `${MARK.viewBox.x} ${MARK.viewBox.y} ${MARK.viewBox.width} ${MARK.viewBox.height}`;

/**
 * Height of the mark on the native splash: `imageWidth` of expo-splash-screen in app.json (the splash
 * image is a square with the mark at full height). Keep them equal so the hand-off is seamless.
 */
const SPLASH_MARK_HEIGHT = 136;

export function LogoMark({
  height,
  ink = BRAND.ink,
  accent = BRAND.gold,
  sparkles = true,
}: {
  height: number;
  ink?: string;
  accent?: string;
  sparkles?: boolean;
}) {
  return (
    <Svg width={height * MARK_RATIO} height={height} viewBox={VIEWBOX}>
      <G fill="none" stroke={ink} strokeLinecap="round" strokeLinejoin="round">
        <Path d={MARK.frame} strokeWidth={MARK.stroke} />
        <Path d={MARK.glassEdge} strokeWidth={MARK.innerStroke} />
        <Path d={MARK.hook} strokeWidth={MARK.stroke} />
      </G>
      {sparkles ? <Path d={sparklePath('both')} fill={accent} /> : null}
    </Svg>
  );
}

/** The mark at icon size, weighted to sit beside line icons (tab bar). */
export function MarkGlyph({ height, color, accent = color }: { height: number; color: string; accent?: string }) {
  return (
    <Svg width={height * MARK_RATIO} height={height} viewBox={VIEWBOX}>
      <G fill="none" stroke={color} strokeWidth={GLYPH.stroke} strokeLinecap="round" strokeLinejoin="round">
        <Path d={MARK.frame} />
        <Path d={MARK.hook} />
      </G>
      <Path d={GLYPH.sparkle} fill={accent} />
    </Svg>
  );
}

/** The mark beside the serif wordmark, as on the home screen. */
export function Wordmark({ size = 40, tagline }: { size?: number; tagline?: string }) {
  const t = useStrings();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.26 }}>
      <LogoMark height={size * 1.28} />
      <View>
        <Txt style={{ fontFamily: fonts.serif, fontSize: size, lineHeight: size * 1.1, color: colors.charcoal, letterSpacing: -0.5 }}>{t.brand}</Txt>
        {tagline ? (
          <Txt variant="label" style={{ fontSize: 10, marginTop: -2 }}>
            {tagline}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Takes over from the native splash with the same mark in the same place, then
 * a light sweeps across the glass, the sparkle catches it, the wordmark rises
 * in and the whole thing fades into the app.
 */
export function BrandSplash({ onShown, onDone }: { onShown: () => void; onDone: () => void }) {
  const t = useStrings();
  const height = SPLASH_MARK_HEIGHT;
  const width = height * MARK_RATIO;
  const unit = height / MARK.viewBox.height;
  const glass = {
    left: (MARK.glass.left - MARK.viewBox.x) * unit,
    top: (MARK.glass.top - MARK.viewBox.y) * unit,
    width: MARK.glass.width * unit,
    height: (MARK.glass.bottom - MARK.glass.top) * unit,
  };
  const large = MARK.sparkles.large;
  const sparkleOrigin = `${(((large.cx - MARK.viewBox.x) / MARK.viewBox.width) * 100).toFixed(1)}% ${(((large.cy - MARK.viewBox.y) / MARK.viewBox.height) * 100).toFixed(1)}%`;
  // Mark + wordmark end up centred together.
  const gap = 18;
  const wordmarkHeight = 72;
  const lift = (gap + wordmarkHeight) / 2;
  const band = glass.width * 0.7;

  const shine = useRef(new Animated.Value(0)).current;
  const twinkle = useRef(new Animated.Value(0)).current;
  const reveal = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const started = useRef(false);

  const run = async () => {
    if (started.current) return;
    started.current = true;
    onShown();
    const reduceMotion = await AccessibilityInfo.isReduceMotionEnabled().catch(() => false);
    const out = Animated.timing(fade, { toValue: 0, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true });
    if (reduceMotion) {
      reveal.setValue(1);
      Animated.sequence([Animated.delay(500), out]).start(() => onDone());
      return;
    }
    Animated.sequence([
      Animated.parallel([
        Animated.timing(shine, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        Animated.sequence([
          Animated.delay(320),
          Animated.timing(twinkle, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(twinkle, { toValue: 0, duration: 380, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.delay(120),
          Animated.timing(reveal, { toValue: 1, duration: 700, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true }),
        ]),
      ]),
      Animated.delay(180),
      out,
    ]).start(() => onDone());
  };

  return (
    <Animated.View onLayout={() => void run()} style={[StyleSheet.absoluteFill, styles.splash, { opacity: fade }]}>
      <Animated.View style={{ width, height, transform: [{ translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [0, -lift] }) }] }}>
        <LogoMark height={height} sparkles={false} />
        <View
          style={{
            position: 'absolute',
            left: glass.left,
            top: glass.top,
            width: glass.width,
            height: glass.height,
            borderTopLeftRadius: glass.width / 2,
            borderTopRightRadius: glass.width / 2,
            overflow: 'hidden',
          }}
        >
          <Animated.View
            style={{
              position: 'absolute',
              top: -glass.height * 0.3,
              width: band,
              height: glass.height * 1.6,
              transform: [
                { translateX: shine.interpolate({ inputRange: [0, 1], outputRange: [-band * 1.6, glass.width + band * 0.4] }) },
                { rotate: '22deg' },
              ],
            }}
          >
            <LinearGradient
              colors={['rgba(185,142,62,0)', 'rgba(185,142,62,0.32)', 'rgba(185,142,62,0)']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </View>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              transformOrigin: sparkleOrigin,
              transform: [
                { scale: twinkle.interpolate({ inputRange: [0, 1], outputRange: [1, 1.4] }) },
                { rotate: twinkle.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '18deg'] }) },
              ],
            },
          ]}
        >
          <Svg width={width} height={height} viewBox={VIEWBOX}>
            <Path d={sparklePath('both')} fill={BRAND.gold} />
          </Svg>
        </Animated.View>
      </Animated.View>

      <Animated.View
        style={[
          styles.wordmark,
          {
            marginTop: height / 2 + gap,
            opacity: reveal.interpolate({ inputRange: [0.2, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
            transform: [{ translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [14, -lift] }) }],
          },
        ]}
      >
        <Txt style={styles.brand}>{t.brand}</Txt>
        <Txt variant="label" style={{ fontSize: 10, letterSpacing: 2.2 }}>
          {t.tagline}
        </Txt>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  splash: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ivory, zIndex: 100 },
  wordmark: { position: 'absolute', top: '50%', left: 0, right: 0, alignItems: 'center', gap: 4 },
  brand: { fontFamily: fonts.serif, fontSize: 46, lineHeight: 50, color: colors.charcoal, letterSpacing: -0.5 },
});
