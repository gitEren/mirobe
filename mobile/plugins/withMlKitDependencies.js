// ML Kit models that Play services downloads at install time are listed in one
// <meta-data android:name="com.google.mlkit.vision.DEPENDENCIES"> entry. expo-camera declares
// "barcode_ui" and the local subject-lift module "subject_segment", and the manifest merger
// refuses two different values. The app manifest wins over libraries, so the combined list is
// declared here with tools:replace.
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const NAME = 'com.google.mlkit.vision.DEPENDENCIES';
const MODELS = ['barcode_ui', 'subject_segment'];

module.exports = function withMlKitDependencies(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults;
    manifest.manifest.$['xmlns:tools'] = manifest.manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    application['meta-data'] = (application['meta-data'] || []).filter((item) => item.$['android:name'] !== NAME);
    application['meta-data'].push({ $: { 'android:name': NAME, 'android:value': MODELS.join(','), 'tools:replace': 'android:value' } });
    return mod;
  });
};
