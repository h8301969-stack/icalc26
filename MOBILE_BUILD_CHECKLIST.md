# 📋 iCalc Mobile Build & Store Submission Checklist

## Pre-Build Checklist

### Code Quality
- [ ] No console.log statements in production code
- [ ] All TypeScript errors fixed (`npm run lint`)
- [ ] Tests passing (`npm run test`)
- [ ] App works in browser

### Environment
- [ ] Set production mode flags
- [ ] Verify Supabase URL is correct
- [ ] Check Supabase RLS policies are set
- [ ] Update app version in `package.json`

### Android-Specific
- [ ] Update `capacitor.config.ts` with correct `appId`
- [ ] Update app name in `android/app/src/main/AndroidManifest.xml`
- [ ] Verify target SDK is 34+ (modern Play Store requirement)
- [ ] Generate signing keystore: `keytool -genkey -v -keystore icalc-release.keystore -keyalg RSA -keysize 2048 -validity 10000 -alias icalc`

### iOS-Specific (macOS only)
- [ ] Create Apple Developer account
- [ ] Register app ID in Apple Developer Portal
- [ ] Create provisioning profiles
- [ ] Create app in App Store Connect
- [ ] Set bundle identifier: `com.icalc.app`

---

## Build Steps

### 1. Install Dependencies
```bash
npm install
```

### 2. Build Web App
```bash
npm run build
```

Check `dist/` folder is created and has `index.html`.

### 3. Sync to Native
```bash
npx cap sync
```

### 4. Android Build
```bash
npm run mobile:android:build
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`

### 5. iOS Build (macOS)
```bash
npm run mobile:ios
```

In Xcode:
1. Product → Build For → Running
2. Product → Archive
3. Distribute App → TestFlight

---

## Play Store Submission (Android)

### Step 1: Prepare Release
```bash
npm run build
npm run mobile:android:build
```

### Step 2: Create App on Play Console
1. Go to [Google Play Console](https://play.google.com/console)
2. Click "Create app"
3. App name: **iCalc**
4. Category: **Business**
5. Type: **App** (not game)

### Step 3: Complete Store Listing
```
Title:              iCalc - POS Calculator
Subtitle:           Professional Inventory Management
Short description:  Fast calculator with invoicing & inventory
Full description:   
  iCalc is a professional point-of-sale calculator with built-in inventory management.
  Features:
  • Fast expression calculator
  • Invoice & receipt printing
  • Inventory tracking
  • Multi-profile support
  • Offline mode
  • Business settings

Category:           Business
Rating:             [Complete questionnaire]
Privacy Policy:     [Your privacy policy URL]
Contact Email:      [Your support email]
```

### Step 4: Add Screenshots
Upload 2-8 screenshots:
- 1080×1920 PNG format
- Show calculator, inventory, invoices, settings
- Add text overlays for clarity

### Step 5: Upload Build
1. Go to Releases → Production
2. Click "Create Release"
3. Upload AAB file: `android/app/build/outputs/bundle/release/app-release.aab`
4. Review and publish

⏱️ **Approval time: 2-4 hours**

---

## App Store Submission (iOS - macOS only)

### Step 1: Create App in App Store Connect
1. Go to [App Store Connect](https://appstoreconnect.apple.com)
2. Click "My Apps" → "+"
3. App name: **iCalc**
4. Bundle ID: **com.icalc.app**
5. SKU: **icalc-001**

### Step 2: Complete Store Listing
```
Subtitle:           Professional Inventory Calculator
Promotional Text:   Fast, offline POS calculator with invoicing

Keywords:           calculator, pos, inventory, business, ios

Description:
  iCalc is a professional point-of-sale calculator with 
  built-in inventory management for small businesses.
  
  ✨ Features:
  • Fast expression calculator
  • Invoice & receipt printing
  • Real-time inventory tracking
  • Multi-profile support
  • Works offline
  • Business information settings

Support URL:        [Your support website]
Privacy Policy URL: [Your privacy policy]
```

### Step 3: Add Screenshots
Per screen size (2-5 per size):
- 5.5" iPhone: 1242×2208 PNG
- 6.7" iPhone: 1284×2778 PNG
- iPad: 2048×2732 PNG

### Step 4: Add App Preview
Optional 15-30 second video showing app features.

### Step 5: Set Pricing & Availability
- Price: **Free** (or your price)
- Territories: Select all or your target regions
- Availability: Immediate

### Step 6: Build & Upload
In Xcode:
```bash
Product → Scheme → Edit Scheme → Set Release
Product → Archive
Select archive → Distribute App → App Store Connect
```

Upload build in App Store Connect.

⏱️ **Approval time: 24-48 hours**

---

## Post-Launch Checklist

### Monitor Crashes
- **Android:** Google Play Console → Crashes & ANRs
- **iOS:** App Store Connect → Analytics → Crashes

### Respond to Reviews
- Check ratings/reviews daily first week
- Respond to negative reviews professionally
- Thank positive reviewers

### Track Analytics
- Monitor daily active users
- Track retention (day 1, 7, 30)
- Monitor crashes and ANRs

### Plan Updates
After launch, common updates:
- Bug fixes (week 1)
- Performance improvements (week 2-4)
- Feature requests (ongoing)

---

## Version Numbering

For app store updates:
```bash
npm version patch   # 1.0.0 → 1.0.1 (bug fix)
npm version minor   # 1.0.0 → 1.1.0 (new feature)
npm version major   # 1.0.0 → 2.0.0 (major update)

npm run build
npm run mobile:build
```

Then rebuild for stores.

---

## Common Issues & Fixes

### Android: "minSdkVersion too low"
Edit `android/build.gradle`:
```gradle
minSdkVersion = 24
targetSdkVersion = 34
```

### iOS: "Provisioning profile not found"
In Xcode: Preferences → Accounts → Download Manual Profiles

### Build size too large
```bash
npm run build -- --minify
npx cap sync
```

### App not launching on device
```bash
npx cap sync
npx cap open android  # Or ios
# Rebuild in Android Studio / Xcode
```

---

## Testing Before Submission

### Android Testing
1. Install on Android device/emulator
2. Test all features:
   - [ ] Calculator works
   - [ ] Invoices save
   - [ ] Inventory updates
   - [ ] Settings persist
   - [ ] Offline mode works
   - [ ] Printing works (if printer available)

### iOS Testing
1. Install via TestFlight
2. Same feature tests as Android
3. Test on multiple device sizes

### Common Test Cases
- [ ] Create invoice → save → recall
- [ ] Add inventory item with image
- [ ] Switch profiles → verify data isolation
- [ ] Go offline → make changes → go online
- [ ] Clear app data → reinstall → verify clean state

---

## File Structure for Submission

```
project/
├── dist/                    # Web build
├── android/                 # Android native
│   └── app/build/outputs/bundle/release/
│       └── app-release.aab  # ← Upload to Play Store
├── ios/                     # iOS native
│   └── App.xcworkspace      # ← Open in Xcode for build
├── public/
│   ├── manifest.json        # App metadata
│   └── icons/               # App icons
└── capacitor.config.ts      # Capacitor config
```

---

## Support Contacts

- **Google Play Support:** support.google.com/googleplay
- **App Store Support:** developer.apple.com/contact
- **Capacitor Docs:** capacitorjs.com

---

**Ready to submit? Start with Android, then iOS. Total time: ~4 hours build + approval time.**
