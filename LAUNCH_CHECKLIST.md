# 🚀 iCalc Launch Checklist - From Development to Live

Complete step-by-step guide to launch iCalc on Play Store and App Store.

---

## Phase 1: Final Development (Week 1)

### Code Quality
- [ ] Run `npm run lint` — fix all warnings
- [ ] Run `npm run test` — all tests passing
- [ ] Remove all `console.log()` from production code
- [ ] Test in browser at full screen width + height
- [ ] Enable strict mode in TypeScript

### Security Review
- [ ] No API keys in code (use environment variables)
- [ ] Supabase RLS policies enabled
- [ ] No passwords logged anywhere
- [ ] No hardcoded URLs except Supabase
- [ ] Verify HTTPS for all API calls

### Feature Completeness
- [ ] All calculator functions working
- [ ] Invoicing saves and prints
- [ ] Inventory CRUD operations complete
- [ ] Profile switching works
- [ ] Offline mode functional
- [ ] Business info settings work
- [ ] Admin access control works

### Performance
- [ ] `npm run build` completes (< 5 seconds)
- [ ] App loads in < 3 seconds on 4G
- [ ] No memory leaks (DevTools → Memory)
- [ ] Smooth animations (60 FPS)

---

## Phase 2: Build Setup (Week 1-2)

### Setup Capacitor
```bash
bash setup-capacitor.sh    # macOS/Linux
setup-capacitor.bat        # Windows
```

Verify:
- [ ] `capacitor.config.ts` created
- [ ] `android/` folder created
- [ ] `ios/` folder created (macOS)
- [ ] `package.json` has mobile scripts

### Configure Apps
```bash
# Update bundle ID and app name
# Android: android/app/src/main/AndroidManifest.xml
# iOS: ios/App/App/App.entitlements
```

- [ ] Android package ID: `com.icalc.app`
- [ ] iOS bundle ID: `com.icalc.app`
- [ ] App name everywhere: `iCalc`

### Icons & Graphics
Create or commission:
- [ ] App icon 512×512 PNG (rounded corners)
- [ ] 5-8 screenshots per platform
- [ ] App preview video (iOS, optional)

Add to project:
- [ ] `android/app/src/main/res/` (various sizes)
- [ ] `ios/App/App/Assets.xcassets/` (via Xcode)

---

## Phase 3: Testing (Week 2)

### Android Testing
```bash
npm run mobile:android
```

On emulator/device test:
- [ ] Calculator: all operations
- [ ] Invoicing: create, save, print
- [ ] Inventory: add, edit, delete
- [ ] Offline: disable network, test features
- [ ] Settings: all options work
- [ ] Permissions: camera, storage, print

### iOS Testing (macOS)
```bash
npm run mobile:ios
```

On simulator/device test:
- [ ] Same as Android checklist
- [ ] Notch/safe area handling
- [ ] StatusBar color correct
- [ ] Haptics work (if supported)

### Cross-Platform
- [ ] Reinstall app, clean data works
- [ ] Large expressions don't crash
- [ ] 100+ inventory items handled
- [ ] Rapid profile switching stable

---

## Phase 4: Store Setup (Week 2)

### Google Play Console
1. Go to [Google Play Console](https://play.google.com/console)
2. Create app: **iCalc**
3. Complete:
   - [ ] App title & description
   - [ ] Screenshots (2-8)
   - [ ] Category: Business
   - [ ] Contact info
   - [ ] Privacy policy URL
   - [ ] Content rating (automatic)

### App Store Connect (macOS)
1. Go to [App Store Connect](https://appstoreconnect.apple.com)
2. Create app: **iCalc**
3. Complete:
   - [ ] Bundle ID: `com.icalc.app`
   - [ ] Description & keywords
   - [ ] Screenshots (per device)
   - [ ] Support URL
   - [ ] Privacy policy URL

### Domain & Privacy
- [ ] Privacy policy written
- [ ] Hosted at yoursite.com/privacy
- [ ] Covers data collection practices
- [ ] Support email configured
- [ ] Support website ready

---

## Phase 5: Build & Upload (Week 3)

### Final Build
```bash
npm run build
npm run mobile:build
```

Verify:
- [ ] `dist/` folder created
- [ ] No build errors
- [ ] All assets included

### Android Build
```bash
npm run mobile:android:build
```

Output:
- [ ] `android/app/build/outputs/bundle/release/app-release.aab` created
- [ ] File size < 50 MB

Upload to Play Store:
1. Play Console → Your App → Releases → Production
2. Click "Create Release"
3. Upload AAB file
4. Review all info
5. Submit for review

### iOS Build (macOS)
```bash
npm run mobile:ios
```

In Xcode:
1. Product → Archive
2. Distribute App → App Store Connect
3. Upload to TestFlight first (test)
4. Then submit to App Store

Upload in App Store Connect:
1. Your App → TestFlight (test)
2. Your App → App Store (production)
3. Review all info
4. Submit for review

---

## Phase 6: Launch Day (Week 3-4)

### Pre-Launch
- [ ] Android submitted (2-4 hours approval)
- [ ] iOS submitted (24-48 hours approval)
- [ ] Monitor store pages for issues
- [ ] Have support email staffed

### Launch
- [ ] Android approved → Live
- [ ] iOS approved → Live
- [ ] Post on social media
- [ ] Email announcement
- [ ] Track initial downloads

### Post-Launch (First Week)
- [ ] Monitor crashes daily
- [ ] Check user reviews
- [ ] Fix critical bugs fast
- [ ] Respond to user questions

---

## Phase 7: Monitoring & Updates (Ongoing)

### Daily (Week 1)
- [ ] Check crash reports
- [ ] Read user reviews
- [ ] Monitor server logs
- [ ] Respond to support emails

### Weekly
- [ ] Analyze usage analytics
- [ ] Identify feature requests
- [ ] Plan bug fixes
- [ ] Update roadmap

### Monthly
- [ ] Release updates
- [ ] Add new features
- [ ] Performance optimization
- [ ] Security patches

---

## Timeline Summary

```
Week 1:  Code quality + Capacitor setup
Week 2:  Testing + Store setup + Build
Week 3:  Submit Android + iOS
Week 3:  Android approved (2-4 hours)
Week 4:  iOS approved (24-48 hours)
Week 4:  LIVE! 🎉

Total: ~3-4 weeks to launch
```

---

## Go/No-Go Decision Points

### Before Building
- [ ] App works perfectly in browser?
- [ ] All features implemented?
- [ ] Team agrees this is ready?

**Decision:** GO / NO-GO

### Before Submitting
- [ ] No crashes in 1 hour of testing?
- [ ] All permissions working?
- [ ] Offline mode tested?

**Decision:** GO / NO-GO

### Before Marketing
- [ ] Both platforms approved?
- [ ] Crash rate < 0.1%?
- [ ] Support team ready?

**Decision:** GO / NO-GO

---

## Troubleshooting During Launch

### App rejected by Play Store
- [ ] Check rejection reason
- [ ] Fix issues
- [ ] Resubmit (instant after fix)

### App rejected by App Store
- [ ] Read detailed rejection
- [ ] Usually policy issues (not technical)
- [ ] Fix and resubmit

### Crashes after launch
```bash
# Quick hotfix
1. Fix bug in code
2. npm run build
3. npm run mobile:build
4. Resubmit to stores
# Live in 2-4 hours (Android) or 24 hours (iOS)
```

### Bad reviews incoming
- [ ] Respond professionally
- [ ] Fix identified issues
- [ ] Push update asap
- [ ] Ask users to update rating

---

## Success Metrics (First Month)

| Metric | Target |
|--------|--------|
| Downloads | 100+ |
| Crash Rate | < 0.1% |
| 1-Day Retention | > 50% |
| 7-Day Retention | > 30% |
| Avg Rating | > 4.0 stars |
| Support Emails | < 1 per day |

---

## Key Documents

- `MOBILE_QUICKSTART.md` — Get running in 5 min
- `MOBILE_DEPLOYMENT.md` — Detailed deployment guide
- `MOBILE_BUILD_CHECKLIST.md` — Pre-submission checklist
- `capacitor.config.ts` — Mobile configuration

---

## Support Resources

- Capacitor: https://capacitorjs.com
- Play Store: https://play.google.com/console
- App Store: https://appstoreconnect.apple.com
- Xcode Help: In Xcode menu → Help → Xcode Help
- Android Docs: https://developer.android.com

---

**You're ready. Follow this checklist and ship with confidence. 🚀**
