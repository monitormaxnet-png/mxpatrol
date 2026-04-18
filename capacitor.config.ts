import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.monitormaxnet.mxpatrol',
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
