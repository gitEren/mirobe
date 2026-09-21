import { useEffect, useRef, useState, useCallback } from 'react';
import { CameraService } from '../services/cameraService';

export function useCamera(initialFacing: 'user' | 'environment' = 'environment') {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>(initialFacing);
  const [isActive, setIsActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [simulatedMode, setSimulatedMode] = useState(false);

  const start = useCallback(
    async (facing: 'user' | 'environment' = facingMode) => {
      setIsLoading(true);
      setError(null);
      setSimulatedMode(false);

      try {
        const newStream = await CameraService.startCamera(facing, videoRef.current);
        setStream(newStream);
        setIsActive(true);
        setFacingMode(facing);

        // Check torch capability
        const track = newStream.getVideoTracks()[0];
        const capabilities: any = track?.getCapabilities ? track.getCapabilities() : {};
        setTorchSupported(Boolean(capabilities?.torch));
      } catch (err: any) {
        console.warn('Live camera start failed, enabling realistic mobile preview fallback:', err);
        setError(err?.message || 'Kamera başlatılamadı');
        // Enable simulation mode so user experience never breaks in preview
        setSimulatedMode(true);
        setIsActive(true);
      } finally {
        setIsLoading(false);
      }
    },
    [facingMode]
  );

  const stop = useCallback(() => {
    CameraService.stopCamera();
    setStream(null);
    setIsActive(false);
    setIsTorchOn(false);
  }, []);

  const flip = useCallback(async () => {
    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    await start(nextFacing);
  }, [facingMode, start]);

  const capture = useCallback((): string => {
    if (videoRef.current && isActive && !simulatedMode) {
      return CameraService.captureFrame(videoRef.current);
    }
    return '';
  }, [isActive, simulatedMode]);

  const toggleTorch = useCallback(async () => {
    if (!stream) return;
    const nextState = !isTorchOn;
    const ok = await CameraService.toggleTorch(stream, nextState);
    if (ok) setIsTorchOn(nextState);
  }, [stream, isTorchOn]);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    videoRef,
    stream,
    facingMode,
    isActive,
    isLoading,
    error,
    isTorchOn,
    torchSupported,
    simulatedMode,
    start,
    stop,
    flip,
    capture,
    toggleTorch,
  };
}
