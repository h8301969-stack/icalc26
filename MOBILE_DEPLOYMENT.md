# iCalc Mobile Deployment Guide (Capacitor)

Complete setup for Play Store (Android) and App Store (iOS) deployment.

## Prerequisites

### macOS (for iOS builds)
```bash
# Install Xcode Command Line Tools
xcode-select --install

# Install Ruby gems for iOS signing
sudo gem install fastlane
```

### All Platforms
```bash
# Install Node.js 18+ from https://nodejs.org/
# Install Android Studio from https://developer.android.com/studio
# Install Java Development Kit (JDK 17+)
```

## Setup Steps

### 1. Install Dependencies
```bash
npm install
```

This installs Capacitor and all mobile plugins.

### 2. Build Web App
```bash
npm run build
```

Creates optimized `dist/` folder for mobile deployment.

### 3. Initialize Capacitor (First Time Only)
```bash
npx cap init
```

When prompted:
- App name: `iCalc`
- App Package ID: `com.icalc.app`
- Web assets directory: `dist`

### 4. Add Android Platform
```bash
npx cap add android
```

Creates `android/` folder with native Android project.

### 5. Add iOS Platform (macOS Only)
```bash
npx cap add ios
```

Creates `ios/` folder with native iOS project.

---

## Development Workflow

### Run on Android Emulator
```bash
npm run mobile:android
```

Opens Android Studio with synced code.

### Run on iOS Simulator (macOS)
```bash
npm run mobile:ios
```

Opens Xcode with synced code.

### Sync Code Changes
```bash
npm run mobile:build
```

Rebuilds web app and syncs to native projects.

---

## Build for Store Submission

### Android (Play Store)

#### Step 1: Generate Signing Key
```bash
cd android && ./gradlew signingReport
```

Or create new keystore:
```bash
keytool -genkey -v -keystore icalc-key.keystore -keyalg RSA -keysize 2048 -validity 10000 -alias icalc
```

#### Step 2: Build Release APK/AAB
```bash
npm run mobile:android:build
```

Outputs to: `android/app/build/outputs/bundle/release/`

#### Step 3: Upload to Play Store
1. Go to [Google Play Console](https://play.google.com/console)
2. Create new app or select iCalc
3. Upload AAB file from step 2
4. Fill in store listing (screenshots, description, etc.)
5. Submit for review

**Timeline:** 2-4 hours for review

---

### iOS (App Store)

#### Step 1: Set Up Apple Developer Account
1. Enroll in [Apple Developer Program](https://developer.apple.com/programs/) ($99/year)
2. Create App ID: `com.icalc.app`
3. Create provisioning profiles

#### Step 2: Configure Xcode Signing
```bash
npm run mobile:ios
```

In Xcode:
1. Select "App" target
2. Go to "Signing & Capabilities"
3. Connect team account
4. Set Bundle Identifier: `com.icalc.app`

#### Step 3: Build for TestFlight
In Xcode:
1. Product → Scheme → Edit Scheme
2. Set Build Configuration to "Release"
3. Product → Archive
4. Distribute App → TestFlight

#### Step 4: Submit to App Store
1. Go to [App Store Connect](https://appstoreconnect.apple.com)
2. Create new app
3. Upload build from TestFlight
4. Fill in store listing (screenshots, description, etc.)
5. Submit for review

**Timeline:** 24-48 hours for review

---

## App Store Listing Checklist

### Common to Both Stores
- [ ] App icon (512×512 PNG, rounded corners)
- [ ] App name (short, keyword-friendly)
- [ ] App description (2-4 sentences)
- [ ] Keywords (comma-separated)
- [ ] Screenshots (at least 2, up to 5)
- [ ] Category: Business or Productivity
- [ ] Content rating questionnaire
- [ ] Privacy policy URL
- [ ] Support email

### Android (Play Store) Additional
- [ ] Feature graphic (1024×500 PNG)
- [ ] Promotional graphic (180×120 PNG)
- [ ] Phone screenshots (up to 8)
- [ ] Tablet screenshots (optional)

### iOS (App Store) Additional
- [ ] App preview video (15-30 seconds, optional)
- [ ] Demo account credentials (if needed)
- [ ] Notes for review (explain any special features)

---

## Version Management

### Update Version for Releases
Edit `capacitor.config.ts` and rebuild:

```bash
# Bump version in package.json
npm version patch  # 0.0.1 → 0.0.2 (bug fix)
npm version minor  # 0.0.x → 0.1.0 (new feature)
npm version major  # 0.x.x → 1.0.0 (breaking change)

# Rebuild and sync
npm run mobile:build
```

---

## Troubleshooting

### "Plugin not found" error
```bash
npm install
npx cap sync
```

### iOS build fails in Xcode
1. Clean build folder: Cmd+Shift+K
2. Delete derived data: `rm -rf ~/Library/Developer/Xcode/DerivedData`
3. Rebuild: Cmd+B

### Android build fails
```bash
cd android
./gradlew clean
./gradlew assembleRelease
```

### Status bar style issues
Edit `capacitor.config.ts` and adjust `StatusBar` config, then:
```bash
npx cap sync
```

---

## Security Checklist

- [ ] Remove dev credentials from code
- [ ] Disable console logging in production
- [ ] Set `isProd` flag in Supabase client
- [ ] Verify API keys are public-safe (Supabase anon key is OK)
- [ ] Test offline mode works
- [ ] Verify SSL pinning (optional, for Supabase)

---

## Post-Launch

### Monitor Crashes
In Android/iOS:
- Google Play Console → Crashes & ANRs
- App Store Connect → Analytics → Crashes

### Update Process
1. Make changes locally
2. `npm run build && npm run mobile:build`
3. Commit & push
4. Increment version
5. Build for store
6. Submit update

---

## Commands Reference

| Command | Purpose |
|---------|---------|
| `npm run build` | Build web app for production |
| `npm run mobile:build` | Build web + sync to mobile |
| `npm run mobile:ios` | Open in Xcode (macOS) |
| `npm run mobile:android` | Open in Android Studio |
| `npx cap sync` | Sync code without rebuilding web |
| `npx cap open ios` | Open Xcode |
| `npx cap open android` | Open Android Studio |

---

## Support

- [Capacitor Docs](https://capacitorjs.com/)
- [Play Store Guidelines](https://play.google.com/console/about/gplayappquality/)
- [App Store Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Xcode Help](https://help.apple.com/xcode/)
