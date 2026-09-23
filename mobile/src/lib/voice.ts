import { useCallback, useState } from 'react';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import type { Lang } from './i18n';

/**
 * On-device speech-to-text (free, no server round trip). The transcript is
 * what gets sent to Jev, like the "I talk → Jev picks" flow in the demo.
 */
export function useVoiceInput(lang: Lang, onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState('');

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('error', () => setListening(false));
  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results[0]?.transcript ?? '';
    setPartial(text);
    if (event.isFinal && text.trim()) {
      setPartial('');
      onFinal(text.trim());
    }
  });

  const start = useCallback(async () => {
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) return false;
    ExpoSpeechRecognitionModule.start({ lang: lang === 'tr' ? 'tr-TR' : 'en-US', interimResults: true, continuous: false });
    return true;
  }, [lang]);

  const stop = useCallback(() => ExpoSpeechRecognitionModule.stop(), []);

  return { listening, partial, start, stop };
}
