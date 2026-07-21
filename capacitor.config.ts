import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.icalc.app',
  appName: 'iCalc',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    StatusBar: {
      style: 'dark',
      backgroundColor: '#1c1c1e'
    },
    App: {
      pauseOnEnteringBackground: true,
      resumeOnEnteringForeground: true
    },
    ScreenReader: {
      enabled: true
    }
  }
};

export default config;
