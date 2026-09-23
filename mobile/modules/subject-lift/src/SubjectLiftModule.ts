import { NativeModule, requireOptionalNativeModule } from 'expo';

export interface LiftResult {
  /** Transparent PNG in the app's temp directory. */
  uri: string;
  width: number;
  height: number;
  /** Share of the photo covered by the lifted subject (0–1). */
  coverage: number;
  instances: number;
}

declare class SubjectLiftModule extends NativeModule<{}> {
  isSupported: boolean;
  liftSubject(uri: string): Promise<LiftResult | null>;
}

// Optional so the JS keeps working in builds without the native module (e.g. web, Expo Go).
export default requireOptionalNativeModule<SubjectLiftModule>('SubjectLift');
