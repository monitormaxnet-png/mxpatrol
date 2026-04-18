import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.monitormaxnet.mxpatrol',
  appName: 'mxpatrol',
  webDir: 'dist',
  server: {
    url: 'https://mxpatrol.lovable.app',
    cleartext: true,
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
    webContentsDebuggingEnabled: true,
  },
};

export default config;
