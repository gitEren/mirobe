import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Heart, RefreshCw, Sparkles, Trash2, Wand2, X } from 'lucide-react-native';
import { GARMENT_CATEGORIES, OCCASIONS, STYLE_TAGS, labelFor, type GarmentRow } from '@mirobe/shared';
import { confirmSpend, type SpendKind } from '@/lib/spend';
import { Image } from 'expo-image';
import { TagList } from '@/components/garment';
import { mediaUrl } from '@/lib/api';
import { Banner, Button, Chip, IconButton, Txt } from '@/components/ui';
import {
  aiErrorMessage,
  deleteGarment,
  ensureAiConsent,
  openWithAccount,
  requestPackshot,
  requireAccount,
  retagGarment,
  scheduleSync,
  selectActiveAvatar,
  updateGarment,
  useStore,
  useStrings,
} from '@/lib/store';
import { colors, fonts, radius } from '@/lib/theme';

/** The server's in-flight window: a 'processing' claim older than this was lost and may be started again. */
const IN_FLIGHT_MS = 3 * 60 * 1000;
const inFlight = (status: string, updatedAt: string) => status === 'processing' && Date.now() - Date.parse(updatedAt) < IN_FLIGHT_MS;

export default function GarmentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useStrings();
  const lang = useStore((s) => s.lang);
  const garment = useStore((s) => s.garments.find((g) => g.id === id));
  const analyzing = useStore((s) => s.analyzing.includes(id));
  const isAnonymous = useStore((s) => s.isAnonymous);
  const aiConsent = useStore((s) => s.aiConsent);
  const avatar = useStore(selectActiveAvatar);
  /** A studio image already on its way: running on this device, or queued at capture (made once tagged). */
  const studioOnItsWay = useStore((s) => s.packshotting.includes(id) || s.autoStudio.includes(id));
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<GarmentRow | null>(null);
  const [view, setView] = useState<'photo' | 'cutout' | 'studio' | null>(null);
  const [studioError, setStudioError] = useState<string | null>(null);
  /** This screen's own request, so a double tap cannot start (and charge) a second packshot. */
  const [studioRequesting, setStudioRequesting] = useState(false);

  if (!garment) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ivory }}>
        <Button title={t.common.close} tone="ghost" onPress={() => router.back()} />
      </View>
    );
  }

  const current = editing && draft ? draft : garment;
  const views = (['studio', 'cutout', 'photo'] as const).filter((v) =>
    v === 'studio' ? garment.packshotUrl : v === 'cutout' ? garment.cutoutUrl : true
  );
  const activeView = view && views.includes(view) ? view : views[0];
  const shownUrl = activeView === 'studio' ? garment.packshotUrl : activeView === 'cutout' ? garment.cutoutUrl : garment.imageUrl;
  const studioBusy = studioRequesting || studioOnItsWay || inFlight(garment.packshotStatus, garment.updatedAt);

  const makeStudio = async () => {
    if (studioRequesting) return;
    setStudioError(null);
    setStudioRequesting(true);
    try {
      await requestPackshot(garment.id);
      setView('studio');
    } catch (error) {
      setStudioError(aiErrorMessage(error, t));
    } finally {
      setStudioRequesting(false);
    }
  };
  // A stuck 'processing' (lost request) no longer blocks re-analysing once the window has passed.
  const pending = analyzing || garment.taggingStatus === 'pending' || inFlight(garment.taggingStatus, garment.updatedAt);

  const toggle = (field: 'occasions' | 'styleTags', value: string) => {
    if (!draft) return;
    const list = draft[field];
    setDraft({ ...draft, [field]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] });
  };

  const startEdit = () => {
    setDraft(garment);
    setEditing(true);
  };

  const saveEdit = () => {
    if (draft) {
      const { name, category, occasions, styleTags } = draft;
      updateGarment(garment.id, { name, category, occasions, styleTags, taggingStatus: category ? 'ready' : garment.taggingStatus });
    }
    setEditing(false);
  };

  const confirmDelete = () =>
    Alert.alert(t.common.delete, t.garment.deleteConfirm, [
      { text: t.common.cancel, style: 'cancel' },
      {
        text: t.common.delete,
        style: 'destructive',
        onPress: () => {
          deleteGarment(garment.id);
          router.back();
        },
      },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 120 }} showsVerticalScrollIndicator={false}>
        <View style={{ padding: 16, paddingTop: 16 }}>
          <View style={styles.hero}>
            <Image
              source={{ uri: mediaUrl(shownUrl) }}
              style={[StyleSheet.absoluteFill, activeView !== 'photo' && { margin: 18 }]}
              contentFit={activeView === 'photo' ? 'cover' : 'contain'}
              transition={200}
            />
          </View>
          {views.length > 1 ? (
            <View style={styles.viewSwitch}>
              {views.map((v) => (
                <Chip key={v} small label={t.garment.views[v]} active={activeView === v} onPress={() => setView(v)} />
              ))}
            </View>
          ) : null}
          <View style={styles.topActions}>
            <IconButton accessibilityLabel={t.common.close} tone="stone" onPress={() => router.back()}>
              <X size={18} color={colors.charcoal} />
            </IconButton>
            <IconButton
              accessibilityLabel={t.garment.favorite}
              tone="stone"
              onPress={() => updateGarment(garment.id, { favorite: !garment.favorite })}
            >
              <Heart size={18} color={colors.charcoal} fill={garment.favorite ? colors.charcoal : 'transparent'} />
            </IconButton>
          </View>
        </View>

        <View style={{ paddingHorizontal: 20, gap: 18 }}>
          {editing ? (
            <TextInput
              value={draft?.name}
              onChangeText={(name) => draft && setDraft({ ...draft, name })}
              style={styles.nameInput}
              placeholder={t.garment.name}
            />
          ) : (
            <View>
              <Txt variant="title">{garment.name || '—'}</Txt>
              <Txt variant="caption" style={{ marginTop: 4 }}>
                {[garment.subcategory, garment.material].filter(Boolean).join(' · ')}
              </Txt>
            </View>
          )}

          {/* An untagged piece waits for sign-in, then for consent to AI processing; a tap on the note asks for it. */}
          {pending && isAnonymous && garment.taggingStatus === 'pending' ? (
            <Pressable onPress={() => requireAccount(`/garment/${garment.id}`)} accessibilityRole="button">
              <Banner text={t.garment.pendingSignIn} />
            </Pressable>
          ) : pending && !aiConsent && garment.taggingStatus === 'pending' ? (
            <Pressable onPress={() => void ensureAiConsent()} accessibilityRole="button">
              <Banner text={t.garment.pendingConsent} />
            </Pressable>
          ) : pending ? (
            <Banner text={t.garment.pending} />
          ) : null}
          {studioError ? <Banner tone="warning" text={studioError} /> : null}
          {garment.taggingStatus === 'failed' && !pending ? <Banner tone="warning" text={garment.description || t.garment.failed} /> : null}
          {garment.description && garment.taggingStatus === 'ready' ? (
            <Txt variant="serif" style={{ fontSize: 17, lineHeight: 22, color: colors.charcoalMuted }}>
              “{garment.description}”
            </Txt>
          ) : null}

          <Field label={t.garment.category}>
            {editing ? (
              <ChipRow values={GARMENT_CATEGORIES} selected={current.category ? [current.category] : []} lang={lang} onToggle={(c) => draft && setDraft({ ...draft, category: c as GarmentRow['category'] })} />
            ) : (
              <Txt variant="bodyStrong">{garment.category ? labelFor(garment.category, lang) : '—'}</Txt>
            )}
          </Field>

          {garment.colors.length > 0 ? (
            <Field label={t.garment.colors}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {garment.colors.map((c) => (
                  <View key={c.hex + c.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={[styles.swatch, { backgroundColor: c.hex }]} />
                    <Txt variant="body">{c.name}</Txt>
                  </View>
                ))}
              </View>
            </Field>
          ) : null}

          <Field label={t.garment.occasions}>
            {editing ? (
              <ChipRow values={OCCASIONS} selected={current.occasions} lang={lang} onToggle={(v) => toggle('occasions', v)} />
            ) : (
              <TagList tags={garment.occasions} lang={lang} />
            )}
          </Field>

          <Field label={t.garment.style}>
            {editing ? (
              <ChipRow values={STYLE_TAGS} selected={current.styleTags} lang={lang} onToggle={(v) => toggle('styleTags', v)} />
            ) : (
              <TagList tags={garment.styleTags} lang={lang} />
            )}
          </Field>

          {!editing ? (
            <>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Field label={t.garment.pattern} flex>
                  <Txt variant="body">{garment.pattern ? labelFor(garment.pattern, lang) : '—'}</Txt>
                </Field>
                <Field label={t.garment.formality} flex>
                  <View style={{ flexDirection: 'row', gap: 4, marginTop: 4 }}>
                    {[1, 2, 3, 4, 5].map((level) => (
                      <View key={level} style={[styles.dot, level <= garment.formality && { backgroundColor: colors.charcoal }]} />
                    ))}
                  </View>
                </Field>
              </View>
              <Field label={t.garment.seasons}>
                <TagList tags={garment.seasons} lang={lang} />
              </Field>
              {garment.extraTags.length > 0 ? (
                <Field label={t.garment.details}>
                  <TagList tags={garment.extraTags} lang={lang} />
                </Field>
              ) : null}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Txt variant="tiny">{garment.confidence ? t.garment.confidence(Math.round(garment.confidence * 100)) : ''}</Txt>
                <Txt variant="tiny">{t.garment.worn(garment.wornCount)}</Txt>
              </View>
            </>
          ) : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {editing ? (
              <>
                <Chip label={t.common.cancel} onPress={() => setEditing(false)} />
                <Chip label={t.common.save} active onPress={saveEdit} />
              </>
            ) : (
              <>
                <Chip label={t.garment.edit} onPress={startEdit} />
                <Chip label={t.garment.markWorn} onPress={() => updateGarment(garment.id, { wornCount: garment.wornCount + 1, lastWornAt: new Date().toISOString() })} />
                <Pressable
                  onPress={() =>
                    confirmSpend('taggings', t.garment.reanalyze, () => {
                      retagGarment(garment.id);
                      scheduleSync(0);
                    })
                  }
                  disabled={pending}
                  style={styles.inlineAction}
                >
                  <RefreshCw size={13} color={colors.charcoal} />
                  <Txt style={{ fontFamily: fonts.sansMedium, fontSize: 12 }}>{t.garment.reanalyze}</Txt>
                  <CostTag kind="taggings" />
                </Pressable>
                {!garment.packshotUrl ? (
                  <Pressable
                    onPress={() => confirmSpend('images', t.garment.studio, () => void makeStudio())}
                    disabled={studioBusy}
                    style={[styles.inlineAction, studioBusy && { opacity: 0.5 }]}
                  >
                    <Wand2 size={13} color={colors.charcoal} />
                    <Txt style={{ fontFamily: fonts.sansMedium, fontSize: 12 }}>{studioBusy ? t.garment.studioBusy : t.garment.studio}</Txt>
                    {!studioBusy ? <CostTag kind="images" /> : null}
                  </Pressable>
                ) : null}
                <Pressable onPress={confirmDelete} style={styles.inlineAction}>
                  <Trash2 size={13} color={colors.danger} />
                  <Txt style={{ fontFamily: fonts.sansMedium, fontSize: 12, color: colors.danger }}>{t.common.delete}</Txt>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </ScrollView>

      {!editing ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Button
            title={t.garment.tryOn}
            size="lg"
            icon={<Sparkles size={16} color={colors.amber} />}
            disabled={garment.taggingStatus !== 'ready'}
            onPress={() =>
              openWithAccount(avatar ? `/mirror?garmentIds=${encodeURIComponent(garment.id)}&render=1&source=avatar` : '/avatar')
            }
          />
        </View>
      ) : null}
    </View>
  );
}

/** Small "1 görsel" badge next to actions that use one of this month's images or taggings. */
function CostTag({ kind }: { kind: SpendKind }) {
  const t = useStrings();
  return (
    <View style={styles.costTag}>
      <Txt style={{ fontSize: 10, fontFamily: fonts.sansSemi, color: colors.ivory }}>{t.spend.badge[kind]}</Txt>
    </View>
  );
}

function Field({ label, children, flex }: { label: string; children: React.ReactNode; flex?: boolean }) {
  return (
    <View style={[{ gap: 8 }, flex && { flex: 1 }]}>
      <Txt variant="label" style={{ fontSize: 10 }}>
        {label}
      </Txt>
      {children}
    </View>
  );
}

function ChipRow({ values, selected, lang, onToggle }: { values: readonly string[]; selected: string[]; lang: 'tr' | 'en'; onToggle: (value: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {values.map((value) => (
        <Chip key={value} small label={labelFor(value, lang)} active={selected.includes(value)} onPress={() => onToggle(value)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { aspectRatio: 3 / 4, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.stoneCard },
  viewSwitch: { position: 'absolute', bottom: 28, alignSelf: 'center', flexDirection: 'row', gap: 6, padding: 4, borderRadius: radius.pill, backgroundColor: 'rgba(251,249,245,0.9)' },
  topActions: { position: 'absolute', top: 28, left: 28, right: 28, flexDirection: 'row', justifyContent: 'space-between' },
  nameInput: {
    fontFamily: fonts.serif,
    fontSize: 28,
    color: colors.charcoal,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 6,
  },
  swatch: { width: 16, height: 16, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.25)' },
  dot: { width: 14, height: 6, borderRadius: 3, backgroundColor: colors.border },
  costTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.charcoal },
  inlineAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: 'rgba(251,249,245,0.95)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
