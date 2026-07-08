import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'co.uk.vantro.app',
  appName: 'Vantro',
  webDir: 'www',

  // Point at the live website — no bundling of the Next.js app. Updates to
  // the site are instant; the native shell only needs rebuilding for native
  // capability changes (new plugins, icons, splash screen, permissions).
  server: {
    url: 'https://vantro.co.uk',
    cleartext: false,
  },

  android: {
    backgroundColor: '#0f172a',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },

  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0f172a',
    },
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#0f172a',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;
