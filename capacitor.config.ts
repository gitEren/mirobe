import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mirobe.app',
  appName: 'Mirobe',
  webDir: 'dist',
  server: {
    url: 'http://localhost:3000',
    cleartext: true
  }
};

export default config;
