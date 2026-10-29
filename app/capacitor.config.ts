// Capacitor configuration (G5: Android packaging). The web build is unaffected;
// `npx cap add android` then generates the native project from this config.
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.attendancetracker.app',
  appName: 'Attendance Tracker',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
}

export default config
