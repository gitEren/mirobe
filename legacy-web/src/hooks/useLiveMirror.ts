import { useCallback, useEffect, useRef, useState } from 'react';
import { connectFalRealtime, FalRealtimeSession } from '../services/falRealtimeService';
import { MIROBE_LIMITS } from '../services/entitlements';
import { LiveMirrorStatus } from '../types';

const MAX_SESSION_SECONDS: number = MIROBE_LIMITS.maxAiMirrorSessionSeconds;

interface UseLiveMirrorOptions {
  stream: MediaStream | null;
  simulatedMode: boolean;
  planId: 'free' | 'premium' | 'pro';
  monthlySecondsRemaining: number;
  onUsage: (seconds: number) => void;
  onMessage?: (message: string) => void;
}

export function useLiveMirror({
  stream,
  simulatedMode,
  planId,
  monthlySecondsRemaining,
  onUsage,
  onMessage,
}: UseLiveMirrorOptions) {
  const [status, setStatus] = useState<LiveMirrorStatus>('idle');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(Math.min(MAX_SESSION_SECONDS, monthlySecondsRemaining));
  const sessionRef = useRef<FalRealtimeSession | null>(null);
  const timerRef = useRef<number | null>(null);
  const connectionTimeoutRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const referenceRef = useRef<string | undefined>(undefined);
  const hasBeenLiveRef = useRef(false);

  const clearConnectionTimeout = useCallback(() => {
    if (connectionTimeoutRef.current) {
      window.clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
  }, []);

  const stopSession = useCallback(
    (reason = 'Oturum durduruldu') => {
      clearConnectionTimeout();
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }

      sessionRef.current?.close();
      sessionRef.current = null;
      setRemoteStream(null);
      setStatus('idle');

      const elapsed = lastTickRef.current;
      if (hasBeenLiveRef.current && elapsed > 0) onUsage(elapsed);
      lastTickRef.current = 0;
      hasBeenLiveRef.current = false;
      if (reason) onMessage?.(reason);
    },
    [clearConnectionTimeout, onMessage, onUsage]
  );

  const startUsageTimer = useCallback(() => {
    if (timerRef.current || !hasBeenLiveRef.current) return;

    timerRef.current = window.setInterval(() => {
      lastTickRef.current += 1;
      setSessionSeconds((current) => current + 1);
      setRemainingSeconds((current) => Math.max(0, current - 1));

      if (lastTickRef.current >= MAX_SESSION_SECONDS || lastTickRef.current >= monthlySecondsRemaining) {
        stopSession('AI Mirror oturumu tamamlandı · yerel kamera açık');
      }
    }, 1000);
  }, [monthlySecondsRemaining, stopSession]);

  const failToFallback = useCallback(
    (fallbackMessage: string) => {
      clearConnectionTimeout();
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }

      const session = sessionRef.current;
      sessionRef.current = null;
      session?.close();
      setRemoteStream(null);
      setStatus('fallback');
      lastTickRef.current = 0;
      hasBeenLiveRef.current = false;
      onMessage?.(fallbackMessage);
    },
    [clearConnectionTimeout, onMessage]
  );

  const beginSession = useCallback(
    (referenceImageUrl?: string) => {
      if (sessionRef.current) return true;

      referenceRef.current = referenceImageUrl;

      if (planId === 'free' || monthlySecondsRemaining <= 0) {
        setStatus('fallback');
        onMessage?.(planId === 'free' ? 'Video Mirror Premium ve Pro paketlerinde açık · fotoğraf modu hazır' : 'AI Mirror kotan doldu · yerel kamera açık');
        return false;
      }

      if (!stream || simulatedMode) {
        setStatus('fallback');
        onMessage?.('Kamera veya Fal bağlantısı yok · yerel kamera açık');
        return false;
      }

      setStatus('connecting');
      setSessionSeconds(0);
      setRemainingSeconds(Math.min(MAX_SESSION_SECONDS, monthlySecondsRemaining));
      lastTickRef.current = 0;
      hasBeenLiveRef.current = false;

      connectionTimeoutRef.current = window.setTimeout(() => {
        failToFallback('Fal bağlantısı yanıt vermedi · yerel kamera açık');
      }, 10000);

      try {
        sessionRef.current = connectFalRealtime({
          stream,
          planId,
          referenceImageUrl,
          onRemoteStream: (nextStream) => {
            clearConnectionTimeout();
            setRemoteStream(nextStream);
            setStatus('live');
            hasBeenLiveRef.current = true;
            if (referenceRef.current) sessionRef.current?.updateReference(referenceRef.current);
            startUsageTimer();
          },
          onStatus: (nextStatus) => {
            if (nextStatus === 'live') {
              clearConnectionTimeout();
              setStatus('live');
              hasBeenLiveRef.current = true;
              if (referenceRef.current) sessionRef.current?.updateReference(referenceRef.current);
              startUsageTimer();
            }
            if (nextStatus === 'connecting') setStatus('connecting');
            if (nextStatus === 'error') {
              failToFallback('Fal canlı bağlantısı kullanılamadı · yerel kamera açık');
            }
          },
          onError: () => {
            failToFallback('Fal bağlantısı başarısız · yerel kamera açık');
          },
        });
      } catch {
        failToFallback('AI Mirror şu an kullanılamıyor · yerel kamera açık');
        return false;
      }

      return true;
    },
    [
      clearConnectionTimeout,
      failToFallback,
      monthlySecondsRemaining,
      planId,
      simulatedMode,
      startUsageTimer,
      stream,
    ]
  );

  const updateReference = useCallback((referenceImageUrl: string) => {
    referenceRef.current = referenceImageUrl;
    sessionRef.current?.updateReference(referenceImageUrl);
  }, []);

  useEffect(() => () => stopSession(''), [stopSession]);

  return {
    status,
    remoteStream,
    sessionSeconds,
    remainingSeconds,
    maxSessionSeconds: MAX_SESSION_SECONDS,
    beginSession,
    updateReference,
    stopSession,
  };
}
