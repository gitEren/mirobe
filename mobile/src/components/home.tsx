import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Briefcase, Camera, Coffee, Footprints, Glasses, Heart, ImagePlus, Lock, Martini, Plane, Shirt, Sparkles } from 'lucide-react-native';
import { addGarmentsFromLibrary } from '@/lib/addGarments';
import { ensureAiConsent, getState, openWithAccount, requireAccount, useStore, useStrings } from '@/lib/store';
import { colors, fonts, radius } from '@/lib/theme';
import { SectionHeader, Txt, haptic } from './ui';

/**
 * First-run card for an empty wardrobe: a small stack of "garment tags" as
 * the illustration, then the two ways in (camera, photo library).
 */
export function EmptyWardrobe({ compact = false }: { compact?: boolean }) {
  const t = useStrings();
  const [importing, setImporting] = useState(false);

  const importPhotos = async () => {
    // Adding pieces needs an account, so nothing is picked before signing in.
    if (!requireAccount()) return;
    setImporting(true);
    try {
      if ((await addGarmentsFromLibrary()) > 0) {
        void haptic('success');
        // Tagging sends the photos to the AI models: asked once they are added ("Not now" keeps them untagged).
        if (!getState().aiConsent) void ensureAiConsent();
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <View style={styles.empty}>
      {!compact ? (
        <View style={styles.stack}>
          <TagCard rotate="-9deg" offset={-80} icon={<Shirt size={26} strokeWidth={1.4} color={colors.charcoal} />} label={t.emptyWardrobe.tags[0]} />
          <TagCard rotate="7deg" offset={80} icon={<Footprints size={26} strokeWidth={1.4} color={colors.charcoal} />} label={t.emptyWardrobe.tags[2]} />
          <TagCard rotate="0deg" offset={0} lifted icon={<Glasses size={26} strokeWidth={1.4} color={colors.ivory} />} label={t.emptyWardrobe.tags[1]} />
        </View>
      ) : null}

      <Txt variant="label" style={{ textAlign: 'center', fontSize: 10 }}>
        {t.emptyWardrobe.kicker}
      </Txt>
      <Txt variant="title" style={{ textAlign: 'center', marginTop: 6 }}>
        {t.emptyWardrobe.title}
      </Txt>
      <Txt variant="caption" style={{ textAlign: 'center', marginTop: 8, lineHeight: 18, paddingHorizontal: 8 }}>
        {t.emptyWardrobe.body}
      </Txt>

      <View style={styles.steps}>
        {t.emptyWardrobe.steps.map((step, index) => (
          <View key={step} style={styles.step}>
            <Txt style={styles.stepNumber}>{index + 1}</Txt>
            <Txt variant="tiny" style={{ color: colors.charcoal, textAlign: 'center' }}>
              {step}
            </Txt>
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={() => {
            void haptic('medium');
            openWithAccount('/scan');
          }}
          style={({ pressed }) => [styles.primary, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}
        >
          <Camera size={16} color={colors.amber} />
          <Txt style={{ color: colors.ivory, fontFamily: fonts.sansSemi, fontSize: 14 }}>{t.emptyWardrobe.scan}</Txt>
        </Pressable>
        <Pressable onPress={() => void importPhotos()} disabled={importing} style={({ pressed }) => [styles.secondary, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
          {importing ? <ActivityIndicator size="small" color={colors.charcoal} /> : <ImagePlus size={16} color={colors.charcoal} />}
          <Txt style={{ fontFamily: fonts.sansSemi, fontSize: 14 }}>{t.emptyWardrobe.gallery}</Txt>
        </Pressable>
      </View>
    </View>
  );
}

function TagCard({ icon, label, rotate, offset, lifted }: { icon: React.ReactNode; label: string; rotate: string; offset: number; lifted?: boolean }) {
  return (
    <View style={[styles.tagCard, lifted && styles.tagCardLifted, { transform: [{ translateX: offset }, { rotate }] }]}>
      <View style={[styles.tagHole, lifted && { borderColor: 'rgba(251,249,245,0.5)' }]} />
      {icon}
      <Txt style={{ fontSize: 9, letterSpacing: 1.2, textTransform: 'uppercase', fontFamily: fonts.sansSemi, color: lifted ? colors.ivory : colors.warmGray }}>
        {label}
      </Txt>
    </View>
  );
}

const OCCASION_ICONS = [Briefcase, Heart, Martini, Coffee, Plane, Sparkles];

/**
 * One tap asks Jev for a specific occasion. Until the wardrobe has a top and a bottom (or a dress) the
 * cards stay visible but locked, with a note saying what is missing; a tap then opens the scanner.
 */
export function QuickOccasions() {
  const t = useStrings();
  const garments = useStore((s) => s.garments);
  const ready = garments.filter((g) => g.taggingStatus === 'ready');
  const hasTop = ready.some((g) => g.category === 'top' || g.category === 'dress');
  const hasBottom = ready.some((g) => g.category === 'bottom' || g.category === 'dress');
  const canDecide = hasTop && hasBottom;
  const missing = hasTop ? t.quick.needBottom : hasBottom ? t.quick.needTop : t.quick.locked;

  return (
    <View style={{ marginTop: 28 }}>
      <SectionHeader title={t.quick.title} />
      {canDecide ? null : (
        <View style={styles.lockNote}>
          <Lock size={15} color={colors.warmGray} />
          <Txt variant="caption" style={{ flex: 1 }}>
            {missing}
          </Txt>
          <Pressable onPress={() => router.push('/scan')} accessibilityRole="button" hitSlop={8} style={styles.addPiece}>
            <Txt style={{ fontFamily: fonts.sansSemi, fontSize: 12, color: colors.ivory }}>{t.quick.addPiece}</Txt>
          </Pressable>
        </View>
      )}
      <View style={[styles.grid, !canDecide && { opacity: 0.45 }]}>
          {t.quick.items.map((item, index) => {
            const Icon = OCCASION_ICONS[index % OCCASION_ICONS.length];
            return (
              <Pressable
                key={item.label}
                accessibilityState={{ disabled: !canDecide }}
                onPress={() => {
                  void haptic(canDecide ? 'medium' : 'light');
                  if (canDecide) openWithAccount(`/stylist?q=${encodeURIComponent(item.query)}`);
                  else router.push('/scan');
                }}
                style={({ pressed }) => [styles.occasion, index === 0 && styles.occasionDark, { transform: [{ scale: pressed ? 0.97 : 1 }] }]}
              >
                <Icon size={18} strokeWidth={1.6} color={index === 0 ? colors.amber : colors.charcoal} />
                <Txt style={{ fontFamily: fonts.sansSemi, fontSize: 13, marginTop: 10, color: index === 0 ? colors.ivory : colors.charcoal }}>{item.label}</Txt>
                <Txt style={{ fontSize: 10, marginTop: 2, color: index === 0 ? 'rgba(251,249,245,0.6)' : colors.warmGray }} numberOfLines={1}>
                  {item.hint}
                </Txt>
              </Pressable>
            );
          })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    marginTop: 4,
    paddingHorizontal: 20,
    paddingTop: 26,
    paddingBottom: 20,
    borderRadius: radius.xl,
    backgroundColor: colors.stone,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  stack: { height: 128, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  tagCard: {
    position: 'absolute',
    width: 86,
    height: 112,
    borderRadius: 16,
    backgroundColor: colors.ivory,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  tagCardLifted: { backgroundColor: colors.charcoal, borderColor: colors.charcoal, shadowOpacity: 0.2 },
  tagHole: { position: 'absolute', top: 10, width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: colors.border },
  steps: { flexDirection: 'row', gap: 8, marginTop: 18 },
  step: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: radius.md,
    backgroundColor: colors.ivory,
  },
  stepNumber: { fontFamily: fonts.serifItalic, fontSize: 20, color: colors.mutedGray },
  actions: { gap: 8, marginTop: 18 },
  primary: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.charcoal,
  },
  secondary: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.ivory,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  occasion: {
    width: '30%',
    flexGrow: 1,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.stone,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  occasionDark: { backgroundColor: colors.charcoal, borderColor: colors.charcoal },
  lockNote: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  addPiece: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.charcoal },
});
