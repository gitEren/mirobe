import { Alert } from 'react-native';
import { router } from 'expo-router';
import { dictionaries } from './i18n';
import { ensureAiConsent, getState, requireAccount } from './store';

/** The monthly allowances a confirmed action can use: studio images and AI re-tagging. */
export type SpendKind = 'images' | 'taggings';

/**
 * Asks before an action that uses one of this month's images or AI taggings. Opens
 * the plans screen when none are left instead of letting the server refuse it.
 */
export function confirmSpend(kind: SpendKind, action: string, onConfirm: () => void) {
  // Paid AI actions need an account; the login screen opens over the current one.
  if (!requireAccount()) return;
  // They send the garment photo to the AI models: the account allows that first ("Not now" stops here).
  void ensureAiConsent().then((allowed) => {
    if (allowed) askToSpend(kind, action, onConfirm);
  });
}

function askToSpend(kind: SpendKind, action: string, onConfirm: () => void) {
  const { usage, lang } = getState();
  const t = dictionaries[lang];
  const left = usage ? Math.max(0, usage[kind].limit - usage[kind].used) : null;
  if (left === 0) {
    Alert.alert(t.spend.notEnoughTitle, t.spend.notEnoughBody[kind], [
      { text: t.common.cancel, style: 'cancel' },
      { text: t.spend.seePlans, onPress: () => router.push('/paywall') },
    ]);
    return;
  }
  Alert.alert(action, t.spend.body[kind](left), [
    { text: t.common.cancel, style: 'cancel' },
    { text: t.spend.confirm[kind], onPress: onConfirm },
  ]);
}
