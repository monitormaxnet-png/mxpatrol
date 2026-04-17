import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.7a762bd665c04e6d941783744dd932b0',
  appName: 'mxpatrol',
  webDir: 'dist',
  server: {
    url: 'https://mxpatrol.lovable.app',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
