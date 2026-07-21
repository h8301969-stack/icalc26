# 📱 iCalc Mobile Deployment - Quick Start

## TL;DR - Get Running in 5 Minutes

### Windows
```bash
setup-capacitor.bat
npm run mobile:android
```

### macOS
```bash
bash setup-capacitor.sh
npm run mobile:ios
npm run mobile:android
```

---

## What Just Happened

✅ Capacitor installed  
✅ Web build created  
✅ Android native project created  
✅ iOS native project created (macOS only)  

---

## Commands You'll Use

```bash
# Development
npm run mobile:build      # Update app after code changes
npm run mobile:ios        # Open in Xcode (macOS)
npm run mobile:android    # Open in Android Studio

# Store submission
npm run mobile:ios:build     # Create iOS release build
npm run mobile:android:build # Create Android release build
```

---

## Store Submission Timeline

### Android (Play Store)
1. Build: 5 minutes
2. Upload: 2 minutes  
3. Play Store review: **2-4 hours**
4. Live: That same day

### iOS (App Store)
1. Build: 10 minutes
2. Upload: 5 minutes
3. App Store review: **24-48 hours**
4. Live: 1-2 days

---

## Before You Submit

### App Icons
Create a 512×512 PNG with rounded corners. Use:
- https://appicon.co (free, drag & drop)
- Output to `ios/App/App/Assets.xcassets/AppIcon.appiconset/`

### Screenshots
- Android: 2-8 screenshots (1080×1920 PNG)
- iOS: 2-5 screenshots (per screen size)

### Store Listing
- App name: "iCalc"
- Description: "Professional POS calculator with inventory management"
- Keywords: calculator, pos, inventory, business
- Category: Business

### Privacy Policy
Go to [Termly](https://termly.io) (free tier):
1. Generate privacy policy
2. Host on your domain
3. Add URL to store listing

---

## Project Structure After Setup

```
icalc26/
├── dist/                      # Web app (created by npm build)
├── ios/                       # iOS native project (Xcode)
├── android/                   # Android native project
├── capacitor.config.ts        # Capacitor config
├── MOBILE_DEPLOYMENT.md       # Full deployment guide
├── MOBILE_QUICKSTART.md       # This file
└── package.json               # Updated with Capacitor scripts
```

---

## Troubleshooting

**"Pod install failed" (iOS)**
```bash
cd ios/App
pod repo update
pod install
cd ../..
```

**"Gradle sync failed" (Android)**
```bash
cd android
./gradlew clean
cd ..
```

**"App not launching"**
```bash
npx cap sync
npm run build
npx cap sync
```

---

## Next Steps

1. **Test on emulator:**
   - `npm run mobile:ios` (macOS)
   - `npm run mobile:android` (all platforms)

2. **Test on real device:**
   - Android: Connect via USB, enable dev mode, run app
   - iOS: Use TestFlight for testing

3. **Submit to stores:**
   - Read `MOBILE_DEPLOYMENT.md` for detailed steps
   - Create app listings on [Google Play Console](https://play.google.com/console) and [App Store Connect](https://appstoreconnect.apple.com)
   - Upload builds and submit for review

4. **Monitor after launch:**
   - Google Play Console → Analytics
   - App Store Connect → App Analytics

---

## Help & Support

- Capacitor: https://capacitorjs.com/docs
- Android: https://developer.android.com/docs
- iOS: https://developer.apple.com/documentation/
- Xcode: `Help → Xcode Help` (in Xcode menu)

---

**Ready to deploy? Read `MOBILE_DEPLOYMENT.md` for the complete guide.**
