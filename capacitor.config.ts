import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.monitormaxnet.mxpatrol',
  appName: 'mxpatrol',
  webDir: 'dist',
  server: {
      androidScheme: 'https'
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
