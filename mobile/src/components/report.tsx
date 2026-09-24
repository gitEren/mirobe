import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Flag } from 'lucide-react-native';
import { AI_REPORT_NOTE_MAX, AI_REPORT_REASONS, type AiReportReason, type AiReportTarget } from '@mirobe/shared';
import { Banner, Button, Txt, haptic } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { reportAiOutput, useStore, useStrings } from '@/lib/store';
import { colors, fonts, radius } from '@/lib/theme';

/** What a report points at. `excerpt`: the text of a Jev reply (the server keeps no chat history). */
export interface ReportTarget {
  type: AiReportTarget;
  id: string;
  excerpt?: string;
}

/** Images the server stops showing after an offensive or privacy report. */
const HIDES: AiReportTarget[] = ['tryon', 'video', 'packshot'];

/**
 * The discreet "Report" entry: a small flag and label. `dark` over the try-on viewer's night
 * theme, light elsewhere. Only registered accounts can report (they are the only ones with AI output).
 */
export function ReportLink({ onPress, dark, style }: { onPress: () => void; dark?: boolean; style?: StyleProp<ViewStyle> }) {
  const t = useStrings();
  const isAnonymous = useStore((s) => s.isAnonymous);
  if (isAnonymous) return null;
  const color = dark ? 'rgba(255,255,255,0.7)' : colors.warmGray;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.report.action}
      hitSlop={8}
      onPress={() => {
        void haptic('light');
        onPress();
      }}
      style={({ pressed }) => [styles.link, { opacity: pressed ? 0.6 : 1 }, style]}
    >
      <Flag size={12} color={color} />
      <Txt style={{ color, fontFamily: fonts.sansMedium, fontSize: 11 }}>{t.report.action}</Txt>
    </Pressable>
  );
}

/**
 * "Report AI output" sheet: a reason, an optional note, send. Mounted by the screen that shows the
 * AI result, so it covers modal screens too. `onSent` gets the thank-you text for the screen's toast
 * (also when the server predates reports); a failure stays in the sheet with the note kept, to retry.
 */
export function ReportSheet({ target, onClose, onSent }: { target: ReportTarget | null; onClose: () => void; onSent: (message: string) => void }) {
  const t = useStrings();
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<AiReportReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every opening starts empty.
  useEffect(() => {
    if (!target) return;
    setReason(null);
    setNote('');
    setBusy(false);
    setError(null);
  }, [target]);

  const close = () => {
    if (!busy) onClose();
  };

  const send = async () => {
    if (!target || !reason || busy) return;
    setBusy(true);
    setError(null);
    try {
      await reportAiOutput({ targetType: target.type, targetId: target.id, reason, note: note.trim() || undefined, excerpt: target.excerpt });
      void haptic('success');
      setBusy(false);
      onClose();
      onSent(t.report.thanks);
    } catch (e) {
      void haptic('warning');
      setError(e instanceof ApiError && e.status === 429 ? t.report.limit : t.report.failed);
      setBusy(false);
    }
  };

  const hides = target && HIDES.includes(target.type) && (reason === 'offensive' || reason === 'privacy');

  return (
    <Modal visible={Boolean(target)} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.backdrop} behavior="padding">
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel={t.common.cancel} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]} accessibilityViewIsModal>
          <ScrollView bounces={false} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ flexGrow: 0, flexShrink: 1 }}>
            <View style={styles.icon}>
              <Flag size={18} color={colors.amber} />
            </View>
            <Txt variant="title" style={{ marginTop: 16 }}>
              {t.report.title}
            </Txt>
            <Txt variant="body" style={{ color: colors.warmGray, marginTop: 6 }}>
              {t.report.body}
            </Txt>
            <View style={{ marginTop: 14 }} accessibilityRole="radiogroup">
              {AI_REPORT_REASONS.map((value) => {
                const selected = reason === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => {
                      void haptic('light');
                      setReason(value);
                    }}
                    style={styles.reason}
                  >
                    <View style={[styles.radio, selected && styles.radioOn]}>{selected ? <View style={styles.radioDot} /> : null}</View>
                    <Txt variant={selected ? 'bodyStrong' : 'body'} style={{ flex: 1 }}>
                      {t.report.reasons[value]}
                    </Txt>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={t.report.note}
              placeholderTextColor={colors.mutedGray}
              maxLength={AI_REPORT_NOTE_MAX}
              multiline
              style={styles.note}
            />
            {hides ? (
              <Txt variant="caption" style={{ marginTop: 10 }}>
                {t.report.hides}
              </Txt>
            ) : null}
          </ScrollView>
          {error ? (
            <View style={{ marginTop: 14 }}>
              <Banner tone="warning" text={error} />
            </View>
          ) : null}
          <Button title={t.report.send} size="lg" loading={busy} disabled={!reason} onPress={() => void send()} style={{ marginTop: 18 }} />
          <Button title={t.common.cancel} tone="ghost" disabled={busy} onPress={close} style={{ marginTop: 10 }} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** A short message that goes away by itself; `null` hides it. */
export function useToast(ms = 3500): [string | null, (message: string | null) => void] {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), ms);
    return () => clearTimeout(timer);
  }, [message, ms]);
  return [message, setMessage];
}

/** The light screens' toast: a charcoal pill floating above the screen's bottom edge. */
export function Toast({ message, bottom }: { message: string | null; bottom: number }) {
  if (!message) return null;
  return (
    <View pointerEvents="none" style={[styles.toastWrap, { bottom }]} accessibilityLiveRegion="polite">
      <View style={styles.toast}>
        <Txt style={{ color: colors.ivory, fontSize: 13, fontFamily: fonts.sansMedium }}>{message}</Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  link: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingVertical: 4 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(26,25,24,0.4)' },
  sheet: {
    maxHeight: '92%',
    paddingHorizontal: 24,
    paddingTop: 24,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.ivory,
  },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.charcoal, alignItems: 'center', justifyContent: 'center' },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.charcoal },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.charcoal },
  note: {
    marginTop: 14,
    minHeight: 72,
    maxHeight: 120,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    borderRadius: radius.md,
    backgroundColor: colors.stone,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.charcoal,
    textAlignVertical: 'top',
  },
  toastWrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  toast: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: colors.charcoal },
});
