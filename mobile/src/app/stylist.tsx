import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowUp, Flag, Mic, Sparkles, X } from 'lucide-react-native';
import { AI_REPORT_EXCERPT_MAX, type StylistChatMessage, type StylistDecision } from '@mirobe/shared';
import { AccountGate } from '@/components/AccountGate';
import { garmentImage, isIsolated } from '@/components/garment';
import { ReportSheet, Toast, useToast, type ReportTarget } from '@/components/report';
import { Button, Chip, IconButton, Txt, haptic } from '@/components/ui';
import { aiErrorMessage, chatWithStylist, ensureAiConsent, requireAccount, saveLook, useStore, useStrings } from '@/lib/store';
import { colors, fonts, radius } from '@/lib/theme';
import { useVoiceInput } from '@/lib/voice';

interface Message extends StylistChatMessage {
  id: string;
  decision?: StylistDecision;
  suggestions?: string[];
  error?: boolean;
  savedLookId?: string;
}

/** Anonymous visitors sign in first; the screen's params survive the detour. */
export default function StylistScreen() {
  const params = useLocalSearchParams();
  return (
    <AccountGate route="/stylist" params={params}>
      <Stylist />
    </AccountGate>
  );
}

function Stylist() {
  const t = useStrings();
  const lang = useStore((s) => s.lang);
  const garments = useStore((s) => s.garments);
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const [toast, setToast] = useToast();
  const scroll = useRef<ScrollView>(null);
  const history = useRef<Message[]>([]);
  /** A message is waiting for the consent sheet: taps meanwhile must not send a second one. */
  const asking = useRef(false);

  const ready = garments.filter((g) => g.taggingStatus === 'ready');
  const canDecide =
    ready.some((g) => g.category === 'top' || g.category === 'dress') && ready.some((g) => g.category === 'bottom' || g.category === 'dress');

  const update = (next: Message[]) => {
    history.current = next;
    setMessages(next);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60);
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy || asking.current) return;
    if (!requireAccount('/stylist')) {
      // Keep the question so it is one tap away after signing in.
      setInput(trimmed);
      return;
    }
    // The message goes to the AI models, so the account allows that first (a home quick-occasion
    // card lands here too). On "Not now" it stays in the box, unsent.
    asking.current = true;
    const allowed = await ensureAiConsent();
    asking.current = false;
    if (!allowed) {
      setInput(trimmed);
      return;
    }
    setInput('');
    const question: Message = { id: `u${Date.now()}`, role: 'user', text: trimmed };
    const withUser = [...history.current, question];
    update(withUser);
    setBusy(true);
    try {
      const result = await chatWithStylist(withUser.filter((m) => !m.error).map(({ role, text: body, garmentIds }) => ({ role, text: body, garmentIds })));
      void haptic(result.decision ? 'success' : 'light');
      update([
        ...history.current,
        {
          id: `a${Date.now()}`,
          role: 'assistant',
          text: result.reply,
          garmentIds: result.decision?.garmentIds,
          decision: result.decision?.garmentIds.length ? result.decision : undefined,
          suggestions: result.suggestions,
        },
      ]);
    } catch (error) {
      const message = aiErrorMessage(error, t);
      if (message) {
        update([...history.current, { id: `e${Date.now()}`, role: 'assistant', text: message, error: true }]);
      } else {
        // "Not now" when the server asked for consent again: the message goes back into the box, unsent.
        update(history.current.filter((m) => m.id !== question.id));
        setInput(trimmed);
      }
    } finally {
      setBusy(false);
    }
  };

  const voice = useVoiceInput(lang, (text) => void send(text));

  const listen = async () => {
    if (!requireAccount('/stylist')) return;
    // What is said reaches Jev as text: the account allows AI processing before listening starts.
    if (await ensureAiConsent()) await voice.start();
  };

  // Opened from a home "quick occasion" card: ask right away. From the daily reminder
  // (`prefill`): the question is only typed in, so no Jev message is spent without a tap.
  const { q, prefill } = useLocalSearchParams<{ q?: string; prefill?: string }>();
  useEffect(() => {
    if (!q && !prefill) return;
    // Consume the params first: a remount or a dev Fast Refresh re-runs this effect,
    // and must never ask Jev (a paid call) twice for the same navigation.
    router.setParams({ q: undefined, prefill: undefined });
    if (q) void send(q);
    else if (prefill) setInput(prefill.slice(0, 500));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.ivory }} behavior="padding">
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={styles.avatar}>
            <Sparkles size={18} color={colors.amber} />
          </View>
          <View>
            <Txt variant="title" style={{ fontSize: 26, lineHeight: 30 }}>
              {t.stylist.title}
            </Txt>
            <Txt variant="caption">{busy ? t.stylist.thinking : t.stylist.subtitle}</Txt>
          </View>
        </View>
        <IconButton accessibilityLabel={t.common.close} tone="stone" onPress={() => router.back()}>
          <X size={18} color={colors.charcoal} />
        </IconButton>
      </View>

      <ScrollView ref={scroll} contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {!canDecide ? (
          <View style={styles.notice}>
            <Txt variant="caption">{t.stylist.needMore}</Txt>
          </View>
        ) : null}

        {messages.length === 0 ? (
          <View style={{ gap: 14 }}>
            <View style={styles.assistantBubble}>
              <Txt variant="body">{t.stylist.greeting}</Txt>
            </View>
            <View style={{ gap: 2 }}>
              {t.stylist.suggestions.map((suggestion) => (
                <Pressable key={suggestion} onPress={() => void send(suggestion)} style={styles.suggestion}>
                  <Txt variant="serif" style={{ fontSize: 19, color: colors.charcoal }}>
                    {suggestion}
                  </Txt>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {messages.map((message) =>
          message.role === 'user' ? (
            <View key={message.id} style={styles.userBubble}>
              <Txt style={{ color: colors.ivory, fontSize: 14, lineHeight: 20 }}>{message.text}</Txt>
            </View>
          ) : (
            <View key={message.id} style={{ gap: 10 }}>
              {/* A Jev reply can be reported: a long press on it, or the small flag below it. */}
              <Pressable
                disabled={message.error}
                onLongPress={() => {
                  void haptic('medium');
                  setReport(replyTarget(message));
                }}
                style={[styles.assistantBubble, message.error && { backgroundColor: '#F7EBD3' }]}
              >
                <Txt variant="body" style={{ lineHeight: 21 }}>
                  {message.text}
                </Txt>
              </Pressable>
              {!message.error ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.report.action}
                  hitSlop={10}
                  onPress={() => setReport(replyTarget(message))}
                  style={styles.flag}
                >
                  <Flag size={11} color={colors.mutedGray} />
                </Pressable>
              ) : null}
              {message.decision ? (
                <OutfitCard
                  decision={message.decision}
                  saved={Boolean(message.savedLookId)}
                  onSave={() => {
                    const look = saveLook({
                      title: message.decision!.title,
                      occasion: message.decision!.occasion,
                      style: message.decision!.style,
                      garmentIds: message.decision!.garmentIds,
                      source: 'jev',
                      note: message.text,
                    });
                    update(history.current.map((m) => (m.id === message.id ? { ...m, savedLookId: look.id } : m)));
                    void haptic('success');
                  }}
                  onTryOn={() => router.push({ pathname: '/mirror', params: { garmentIds: message.decision!.garmentIds.join(',') } })}
                />
              ) : null}
              {message === lastAssistant && !busy && message.suggestions?.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {message.suggestions.map((suggestion) => (
                    <Chip key={suggestion} small label={suggestion} onPress={() => void send(suggestion)} />
                  ))}
                </View>
              ) : null}
            </View>
          )
        )}

        {busy ? (
          <View style={[styles.assistantBubble, { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }]}>
            <ActivityIndicator color={colors.warmGray} size="small" />
            <Txt variant="caption">{t.stylist.thinking}</Txt>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.inputBar, { paddingBottom: insets.bottom + 10 }]}>
        <Pressable
          onPress={() => (voice.listening ? voice.stop() : void listen())}
          style={[styles.micButton, voice.listening && { backgroundColor: colors.danger }]}
          accessibilityLabel="mic"
        >
          <Mic size={18} color={voice.listening ? colors.white : colors.charcoal} />
        </Pressable>
        <TextInput
          value={voice.listening ? voice.partial || t.stylist.listening : input}
          onChangeText={setInput}
          placeholder={t.stylist.placeholder}
          placeholderTextColor={colors.mutedGray}
          style={styles.input}
          editable={!voice.listening}
          onSubmitEditing={() => void send(input)}
          returnKeyType="send"
        />
        <Pressable onPress={() => void send(input)} disabled={!input.trim() || busy} style={[styles.send, (!input.trim() || busy) && { opacity: 0.35 }]}>
          <ArrowUp size={18} color={colors.ivory} />
        </Pressable>
      </View>
      <Toast message={toast} bottom={insets.bottom + 72} />
      <ReportSheet target={report} onClose={() => setReport(null)} onSent={setToast} />
    </KeyboardAvoidingView>
  );
}

/** A Jev reply as a report target: its local id, and its text (the server keeps no chat history). */
const replyTarget = (message: Message): ReportTarget => ({ type: 'stylist', id: message.id, excerpt: message.text.slice(0, AI_REPORT_EXCERPT_MAX) });

function OutfitCard({ decision, saved, onSave, onTryOn }: { decision: StylistDecision; saved: boolean; onSave: () => void; onTryOn: () => void }) {
  const t = useStrings();
  const garments = useStore((s) => s.garments);
  const items = decision.garmentIds.map((id) => garments.find((g) => g.id === id)).filter((g) => g !== undefined);
  return (
    <View style={styles.outfit}>
      <Txt style={{ fontFamily: fonts.serif, fontSize: 20, lineHeight: 24 }}>{decision.title}</Txt>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginTop: 12 }}>
        {items.map((garment) => (
          <Pressable key={garment.id} onPress={() => router.push({ pathname: '/garment/[id]', params: { id: garment.id } })} style={{ width: 92 }}>
            <Image source={{ uri: garmentImage(garment) }} style={styles.itemImage} contentFit={isIsolated(garment) ? 'contain' : 'cover'} />
            <Txt variant="tiny" numberOfLines={1} style={{ marginTop: 4, color: colors.charcoal }}>
              {garment.name}
            </Txt>
          </Pressable>
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
        <Button title={t.stylist.tryOn} size="sm" icon={<Sparkles size={14} color={colors.amber} />} onPress={onTryOn} />
        <Chip label={saved ? t.stylist.saved : t.stylist.save} active={saved} onPress={saved ? undefined : onSave} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.charcoal, alignItems: 'center', justifyContent: 'center' },
  flag: { alignSelf: 'flex-start', marginTop: -6, marginLeft: 10, padding: 2 },
  notice: { padding: 12, borderRadius: radius.md, backgroundColor: colors.stone },
  suggestion: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderBottomRightRadius: 6,
    backgroundColor: colors.charcoal,
  },
  assistantBubble: {
    maxWidth: '92%',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 18,
    borderBottomLeftRadius: 6,
    backgroundColor: colors.stone,
  },
  outfit: { padding: 14, borderRadius: radius.lg, backgroundColor: colors.white, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  itemImage: { width: 92, height: 120, borderRadius: 12, backgroundColor: colors.stoneCard },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.ivory,
  },
  micButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.stone },
  input: {
    flex: 1,
    height: 42,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.stone,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.charcoal,
  },
  send: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.charcoal },
});
