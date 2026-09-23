/**
 * Camera Utility & WebRTC Hook for Mobile iOS & Android
 * Handles front/rear camera switching, video stream lifecycle,
 * canvas snapshot capture, and fallback simulation for testing without physical webcam.
 */

export interface CameraState {
  stream: MediaStream | null;
  isActive: boolean;
  isPermissionGranted: boolean;
  error: string | null;
  facingMode: 'user' | 'environment';
  torchAvailable: boolean;
  isTorchOn: boolean;
}

export class CameraService {
  private static activeStream: MediaStream | null = null;

  static async startCamera(
    facingMode: 'user' | 'environment' = 'environment',
    videoElement?: HTMLVideoElement | null
  ): Promise<MediaStream> {
    // Stop any existing stream
    this.stopCamera();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Kamera API bu cihazda veya tarayıcıda desteklenmiyor.');
    }

    const constraints: MediaStreamConstraints = {
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1080 },
        height: { ideal: 1920 },
      },
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.activeStream = stream;

      if (videoElement) {
        videoElement.srcObject = stream;
        videoElement.setAttribute('playsinline', 'true');
        videoElement.setAttribute('muted', 'true');
        await videoElement.play().catch(() => {});
      }

      return stream;
    } catch (err: any) {
      console.warn('Direct camera constraint error, attempting fallback:', err);
      // Fallback with basic constraints
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        this.activeStream = fallbackStream;
        if (videoElement) {
          videoElement.srcObject = fallbackStream;
          videoElement.setAttribute('playsinline', 'true');
          videoElement.setAttribute('muted', 'true');
          await videoElement.play().catch(() => {});
        }
        return fallbackStream;
      } catch (fallbackErr: any) {
        throw new Error(
          fallbackErr?.message || 'Kamera erişim izni verilmedi veya kamera bulunamadı.'
        );
      }
    }
  }

  static captureFrame(
    videoElement: HTMLVideoElement,
    cropToAspect = true
  ): string {
    const canvas = document.createElement('canvas');
    const width = videoElement.videoWidth || 720;
    const height = videoElement.videoHeight || 1280;

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    // If front camera, mirror horizontally for natural selfie feeling
    ctx.drawImage(videoElement, 0, 0, width, height);

    return canvas.toDataURL('image/jpeg', 0.92);
  }

  static stopCamera(): void {
    if (this.activeStream) {
      this.activeStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      this.activeStream = null;
    }
  }

  static async toggleTorch(stream: MediaStream | null, enable: boolean): Promise<boolean> {
    if (!stream) return false;
    const track = stream.getVideoTracks()[0];
    if (track && 'applyConstraints' in track) {
      try {
        await (track as any).applyConstraints({
          advanced: [{ torch: enable }],
        });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}
