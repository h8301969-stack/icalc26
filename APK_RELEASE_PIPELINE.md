# APK release pipeline (git push → build → Vercel + GitHub)

This repo ships a downloadable Android app from Settings (**Get app on phone**).  
The default download URL is the rolling GitHub release asset:

```text
https://github.com/h8301969-stack/icalc26/releases/download/apk-latest/icalc.apk
```

That APK is produced by the Capacitor Android build and must be rebuilt whenever the app changes.

## How the pieces fit together

```
  developer
      │  git push  (main)
      ▼
 ┌────────────────────────────┐
 │  GitHub Actions            │
 │  1. npm ci + vite build    │
 │  2. cap sync android       │
 │  3. gradle assembleRelease │  ← APK with this commit’s code
 │  4. publish GitHub Release │  ← always a downloadable “latest”
 │  5. (optional) commit APK  │  ← so Vercel can serve /icalc.apk
 └────────────┬───────────────┘
              │
     ┌────────┴────────┐
     ▼                 ▼
 GitHub Releases     Vercel deploy
 (icalc.apk asset)   (site + public/icalc.apk if committed)
```

| Destination | What users get | How it stays fresh |
|-------------|----------------|--------------------|
| **GitHub Releases** | APK attached to a release | Workflow uploads on every push to `main` |
| **Vercel** | Web app; Settings can link to `/icalc.apk` | Vite copies `public/icalc.apk` into the deploy **only if that file is in the repo at build time** |

Important: `public/icalc.apk` is **gitignored** by default (see `.gitignore`).  
Vercel never sees a local-only APK. You either:

1. **Recommended:** point the download at the GitHub release asset (always the latest build), or  
2. **Optional:** let CI force-commit `public/icalc.apk` so each Vercel deploy includes the file at `/icalc.apk`.

## What happens on each `git push` to `main`

Workflow file: [`.github/workflows/release-apk.yml`](.github/workflows/release-apk.yml)

1. **Checkout** the commit that was pushed.  
2. **Install Node + Java**, run `npm ci`, `npm run build`, `npx cap sync android`.  
3. **Build Android**  
   - Signed **release** if keystore secrets are set (see below).  
   - Otherwise **debug** APK (still installable for testing).  
4. **Copy** the APK to `public/icalc.apk` in the CI workspace.  
5. **GitHub Release**  
   - Tag like `apk-YYYYMMDD-HHMMSS` (one release per push).  
   - Asset name: **`icalc.apk`**.  
   - Also keeps a movable tag **`apk-latest`** so this URL always works:

   ```text
   https://github.com/h8301969-stack/icalc26/releases/latest/download/icalc.apk
   ```

   (`apk-latest` is updated in place so “latest” means newest APK, not necessarily newest git tag.)

6. **Optional Vercel sync** (job step, controlled by secret `COMMIT_APK_TO_REPO=true`):  
   - Force-adds `public/icalc.apk`, commits with `[skip ci]`, pushes to `main`.  
   - Vercel rebuilds and serves `/icalc.apk` from that commit.

Without step 6, Vercel only serves an APK if someone manually committed one (or you change the download URL to GitHub).

## Download URL options

### A. GitHub Releases (recommended)

In Settings, link to:

```text
https://github.com/h8301969-stack/icalc26/releases/latest/download/icalc.apk
```

- Always the newest CI build.  
- No large binary in the repo.  
- Works even if Vercel doesn’t host the APK.

### B. Same-origin `/icalc.apk` (current Settings UI)

```html
href="/icalc.apk"
```

- Served from Vercel’s static output (`public/` → site root).  
- Requires the APK to be present when **Vercel** runs `npm run build` (committed APK or CI commit step).

You can support both: primary GitHub URL, fallback `/icalc.apk`.

## Generate a release keystore (once)

On your machine (JDK `keytool`):

```bash
keytool -genkey -v -keystore android/app/release.keystore -keyalg RSA -keysize 2048 -validity 10000 -alias icalc
```

- Keep the `.keystore` file **out of git** (already gitignored).
- Remember store password, key alias (`icalc` if you use that), and key password.
- Base64 the file into the `ANDROID_KEYSTORE_BASE64` GitHub secret (see below).
- Align `android/app/build.gradle` signing config (or CI secrets) with the same alias/passwords.

Example alias name from a generic tutorial (`my-key-alias`) is fine — just use the **same** alias in secrets and Gradle.

## Secrets (GitHub → Settings → Secrets and variables → Actions)

| Secret | Required | Purpose |
|--------|----------|---------|
| `ANDROID_KEYSTORE_BASE64` | For Play-style **release** APK | Base64 of `android/app/release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | With keystore | Keystore password |
| `ANDROID_KEY_ALIAS` | With keystore | Key alias (e.g. `icalc`) |
| `ANDROID_KEY_PASSWORD` | With keystore | Key password |
| `COMMIT_APK_TO_REPO` | Optional | Set to `true` to force-commit `public/icalc.apk` for Vercel |

Encode the keystore (local machine, never commit the file):

```bash
# macOS / Linux
base64 -i android/app/release.keystore | pbcopy

# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("android\app\release.keystore")) | Set-Clipboard
```

If signing secrets are missing, CI still builds a **debug** APK and attaches it to the release (fine for internal testing, not ideal for public “store” distribution).

## Local equivalent (what CI runs)

```bash
npm ci
npm run build
npx cap sync android
cd android && ./gradlew assembleRelease   # or assembleDebug
# APK ends up under android/app/build/outputs/apk/...
cp android/app/build/outputs/apk/release/app-release.apk public/icalc.apk
```

Windows: `gradlew.bat` instead of `./gradlew`.

## Vercel

- Vercel deploys the **web** app on push (or via its GitHub integration).  
- It does **not** run Gradle.  
- It only ships an APK if `public/icalc.apk` exists in the tree at deploy time, **or** you don’t host the APK on Vercel at all and use the GitHub release URL.

Typical setup:

1. Connect the repo to Vercel → auto-deploy web on push.  
2. Enable **release-apk** workflow for the Android binary + GitHub Release.  
3. Either set `COMMIT_APK_TO_REPO=true` **or** point Settings download at the release URL.

## Do you need a new GitHub Release on every push?

| Approach | Pros | Cons |
|----------|------|------|
| **Release per push** (this workflow) | Clear history; every deploy has a downloadable build | Many tags/releases over time |
| **Single rolling `apk-latest` only** | Clean releases list | Harder to grab an older build |
| **Release on tag only** (`v1.2.3`) | Intentional versioning | APK can lag behind web unless you tag often |

Current workflow: **new release per push to `main`**, plus tag **`apk-latest`** rewritten to the newest APK for a stable download link.

## Checklist after enabling CI

- [ ] Workflow file is on `main`: `.github/workflows/release-apk.yml`  
- [ ] GitHub Actions is allowed for the repo  
- [ ] (Optional) Signing secrets added  
- [ ] (Optional) `COMMIT_APK_TO_REPO=true` if Vercel must host `/icalc.apk`  
- [ ] Settings download URL matches your choice (release vs `/icalc.apk`)  
- [ ] Push a commit → Actions green → Release has `icalc.apk` → try download

## Security notes

- Never commit `release.keystore` (already gitignored).  
- Prefer GitHub secrets over hardcoding passwords in `android/app/build.gradle`.  
- Treat release signing passwords like production credentials.

## Related scripts

| Script | Use |
|--------|-----|
| `npm run mobile:build` | Web build + `cap sync` |
| `npm run mobile:android:build` | Local Windows release APK |
| `npm run mobile:android:build:debug` | Local debug APK |
