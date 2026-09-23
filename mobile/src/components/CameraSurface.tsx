import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { CameraView } from 'expo-camera';
import { Image } from 'expo-image';
import { Directory, File, Paths } from 'expo-file-system';
import { alignPhoto, screenRotation, type HeldOrientation } from '@/lib/media';

/**
 * The iOS Simulator has no camera. In development, `npm run sim-camera` streams
 * the Mac webcam on localhost:8090 (localhost inside the simulator is the Mac),
 * and this surface shows that feed instead of the black CameraView. On a real
 * device localhost:8090 is not served, so the probe fails and the real camera
 * is used. Release builds never probe.
 */
const SIM_CAMERA = 'http://127.0.0.1:8090';
let available = false;

/** Re-probes on every camera screen until found, so starting the stream later still works. */
async function simCameraAvailable(): Promise<boolean> {
  if (!__DEV__ || Platform.OS !== 'ios') return false;
  if (available) return true;
  available = await fetch(`${SIM_CAMERA}/health`, { signal: AbortSignal.timeout(800) })
    .then((response) => response.ok)
    .catch(() => false);
  return available;
}

export interface CameraSurfaceHandle {
  /**
   * The photo as the portrait screen showed it, whichever way the phone was held.
   * `unmirror`: a front-camera photo comes back the right way round (printed text
   * readable) instead of mirrored like the preview.
   */
  takePictureAsync: (options?: { quality?: number; unmirror?: boolean }) => Promise<{ uri: string; width: number; height: number } | undefined>;
}

export function CameraSurface({
  ref,
  facing,
  style,
}: {
  ref?: Ref<CameraSurfaceHandle>;
  facing: 'front' | 'back';
  style?: StyleProp<ViewStyle>;
}) {
  const camera = useRef<CameraView>(null);
  const [simulated, setSimulated] = useState<boolean | null>(__DEV__ && Platform.OS === 'ios' ? null : false);
  /** How the phone is held, as the camera itself sees it (it uses the same value for the photo). */
  const held = useRef<HeldOrientation>('portrait');

  useEffect(() => {
    void simCameraAvailable().then(setSimulated);
  }, []);

  useImperativeHandle(ref, () => ({
    takePictureAsync: async (options) => {
      if (simulated) {
        const directory = new Directory(Paths.cache, 'sim-camera');
        if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
        const file = await File.downloadFileAsync(`${SIM_CAMERA}/snapshot.jpg?t=${Date.now()}`, new File(directory, `${Date.now()}.jpg`));
        return { uri: file.uri, width: 720, height: 1280 };
      }
      const photo = await camera.current?.takePictureAsync({ quality: options?.quality ?? 0.85, shutterSound: false });
      if (!photo) return undefined;
      const mirrored = facing === 'front';
      // Only a landscape result was taken sideways: the preview (and so the framing) is portrait.
      const rotate = photo.width > photo.height ? screenRotation(held.current, mirrored) : 0;
      return alignPhoto({ uri: photo.uri, width: photo.width, height: photo.height }, { rotate, unmirror: mirrored && options?.unmirror });
    },
  }));

  if (simulated === null) return <View style={[style, { backgroundColor: '#000' }]} />;
  if (simulated) return <SimulatedFeed style={style} mirror={facing === 'front'} />;
  return (
    <CameraView
      ref={camera}
      style={style}
      facing={facing}
      mirror={facing === 'front'}
      animateShutter
      // The app is portrait-locked but the camera follows gravity: a tilted phone saves a
      // landscape photo. Tracking the same orientation the camera uses lets
      // takePictureAsync turn it back to what the screen showed (iOS; elsewhere a no-op).
      responsiveOrientationWhenOrientationLocked
      onResponsiveOrientationChanged={({ orientation }) => {
        held.current = orientation;
      }}
    />
  );
}

/** Double-buffered snapshot polling: the next frame loads underneath, then swaps in, so there is no flicker. */
function SimulatedFeed({ style, mirror }: { style?: StyleProp<ViewStyle>; mirror: boolean }) {
  const [frames, setFrames] = useState<[string, string]>([`${SIM_CAMERA}/snapshot.jpg?t=0`, `${SIM_CAMERA}/snapshot.jpg?t=1`]);
  const [front, setFront] = useState<0 | 1>(0);
  const loading = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => {
      if (loading.current) return;
      loading.current = true;
      const back = front === 0 ? 1 : 0;
      setFrames((current) => {
        const next: [string, string] = [...current];
        next[back] = `${SIM_CAMERA}/snapshot.jpg?t=${Date.now()}`;
        return next;
      });
    }, 90);
    return () => clearInterval(timer);
  }, [front]);

  const flip = mirror ? { transform: [{ scaleX: -1 }] } : null;
  return (
    <View style={[style, { backgroundColor: '#000', overflow: 'hidden' }]}>
      {([0, 1] as const).map((index) => (
        <Image
          key={index}
          source={{ uri: frames[index] }}
          cachePolicy="none"
          transition={0}
          contentFit="cover"
          style={[StyleSheet.absoluteFill, flip, { opacity: index === front ? 1 : 0 }]}
          onLoad={() => {
            if (index !== front) {
              setFront(index);
              loading.current = false;
            }
          }}
          onError={() => {
            loading.current = false;
          }}
        />
      ))}
    </View>
  );
}
