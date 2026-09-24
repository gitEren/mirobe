// app.json holds the whole config; this wrapper only adds what depends on local files.
//
// google-services.json (Firebase, Android push through FCM) is kept out of git. Put it at
// mobile/google-services.json and run `npx expo prebuild -p android` again: the Google
// Services Gradle plugin is then applied and expo-notifications can get FCM tokens.
// Without the file the app builds and runs as before, with push simply off on Android
// (getDevicePushTokenAsync fails and notifications.ts skips the registration).
const fs = require('node:fs');
const path = require('node:path');

const GOOGLE_SERVICES = './google-services.json';

module.exports = ({ config }) => {
  if (fs.existsSync(path.join(__dirname, GOOGLE_SERVICES))) {
    config.android = { ...config.android, googleServicesFile: GOOGLE_SERVICES };
  }
  return config;
};
