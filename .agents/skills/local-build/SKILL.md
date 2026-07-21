---
name: local-build
description: Build local DMG and APK artifacts of Paseo (bypassing release/CI). Use when the user says "build dmg", "build apk", "编译 dmg", "编译 apk", "本地编译", or wants runnable installers for personal use without a formal release. Handles GFW network blocks on Java/gradle TLS and the macOS Tahoe dmgbuild bug. Produces unsigned, unnotarized artifacts in packages/desktop/release/ and packages/app/android/app/build/outputs/apk/release/.
user-invocable: true
---

# Local build (DMG + APK)

Build runnable Paseo installers for personal use — no version bump, no changelog, no tag, no npm publish, no GitHub Actions, no store submission. The opposite of `release-beta`/`release-stable`.

**Read this whole file before running.** Every step below exists because a real failure mode was hit and solved during development of this skill.

## When to use

- User wants a DMG and/or APK to install on their own machines.
- User is on a feature branch (e.g. `save-host-tools`) that isn't on `main` and shouldn't be released yet.
- User is behind the GFW (mainland China) — gradle/electron downloads fail with TLS handshake errors.
- User is on macOS 25+ (Tahoe) where `dmgbuild` bundle crashes on `hdiutil` plist parsing.

If the user actually wants to ship to other people, use `release-beta` or `release-stable` instead.

## Prerequisites (one-time machine setup)

### Java 17 (for APK)

```bash
brew install openjdk@17
# Java home: /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
```

### Android SDK (for APK)

Install via Android Studio or command-line tools. Required components:

- `platforms;android-35`
- `build-tools;35.0.0` (or 34.0.0)
- `platform-tools`

SDK must live at `/opt/homebrew/share/android-commandlinetools` (homebrew cask) or `~/Library/Android/sdk` (Android Studio). Set `ANDROID_HOME` and `ANDROID_SDK_ROOT` accordingly.

Verify:

```bash
/opt/homebrew/bin/sdkmanager --list_installed   # needs JAVA_HOME set
```

### Node 23+ and repo deps

```bash
node -v                  # >= 23
npm install              # at repo root, after clone
```

## Step 0 — Worktree hygiene

**Build in a worktree on the branch that has your changes.** Confirm the branch HEAD has the code you want:

```bash
git log -1 --format='%H %s'
# verify your feature files are present, e.g.:
ls packages/app/src/host-tools/   # if building the host-tools branch
```

If the worktree is on `main` but your code is on `save-host-tools` (or any feature branch), `git checkout` the right branch first. Building the wrong branch is the #1 waste of time here.

**Do not build in a worktree whose `node_modules` is missing or stale** — run `npm install` at repo root if `node_modules` is absent.

## Step 1 — Patch aliyun maven mirrors (GFW bypass, REQUIRED for APK in China)

The GFW selectively blocks Java TLS clients (gradle) to `plugins.gradle.org`, `repo.maven.apache.org`, and `dl.google.com` — even when `curl` to the same URLs returns 200. The only reliable fix is rewriting all gradle repository declarations to aliyun mirrors.

The patcher script lives at `scripts/patch-aliyun-mirror.py`. It:

- Scans `node_modules/**` and `packages/app/android/**` for `.gradle`/`.gradle.kts` files containing `gradlePluginPortal()`, `google()`, or `mavenCentral()`.
- Injects three aliyun mirror `maven { url ... }` lines at the top of every `repositories {` block.
- Handles both Groovy (`maven { url '...' }`) and Kotlin DSL (`maven { url = uri("...") }`).
- Correctly handles single-line blocks like `repositories { mavenCentral() }` (expands them) and multi-line blocks.

```bash
cd <repo-root>
grep -rlE "gradlePluginPortal\(\)|google\(\)|mavenCentral\(\)" \
    node_modules packages/app/android \
    --include="*.gradle" --include="*.gradle.kts" 2>/dev/null \
  | grep -vE "src/test|src/main" \
  | python3 scripts/patch-aliyun-mirror.py .
```

**ALSO** create `~/.gradle/init.d/aliyun-mirror.gradle` — this catches `pluginManagement` for included builds that have no settings file of their own (e.g. `expo-dev-launcher-gradle-plugin`):

```gradle
beforeSettings { settings ->
    settings.pluginManagement {
        repositories {
            maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }
            maven { url 'https://maven.aliyun.com/repository/public' }
            maven { url 'https://maven.aliyun.com/repository/google' }
        }
    }
}
allprojects {
    buildscript {
        repositories {
            maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }
            maven { url 'https://maven.aliyun.com/repository/public' }
            maven { url 'https://maven.aliyun.com/repository/google' }
        }
    }
}
```

**Re-patch after `expo prebuild --clean`.** `prebuild --clean` regenerates `packages/app/android/build.gradle` and wipes the patch. The APK build script below re-runs the patcher after prebuild.

**Do NOT use `RepositoriesMode.PREFER_SETTINGS`** in the init.d script — it causes "repository was added by settings file" warnings on every included build and breaks nothing but floods the log.

## Step 2 — Build DMG (macOS desktop)

### 2a. Set electron mirror (npmmirror, GFW bypass for electron download)

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
```

### 2b. Build web bundle (electron variant) + server + desktop main

```bash
npm run build:app-deps:clean
(cd packages/app && PASEO_WEB_PLATFORM=electron npx expo export --platform web)
npm run build:server:clean
(cd packages/desktop && npm run build:main)
```

### 2c. electron-builder (unsigned, notarize off)

```bash
(cd packages/desktop && \
  CSC_IDENTITY_AUTO_DISCOVERY=false \
  npx electron-builder --config electron-builder.yml -c.mac.notarize=false --mac)
```

`CSC_IDENTITY_AUTO_DISCOVERY=false` disables code signing (no Apple Developer ID needed). `-c.mac.notarize=false` overrides the `notarize: true` in `electron-builder.yml`.

### 2d. If `dmgbuild` crashes (macOS Tahoe / Python 3.14 plist bug)

electron-builder produces the `.app` and `.zip` successfully, then fails building the `.dmg` with:

```
plistlib.InvalidFileException: Invalid file
  at .../dmgbuild/core.py line 60, in hdiutil
```

The `.app` is already at `packages/desktop/release/mac-arm64/Paseo.app`. Build the DMG manually with `hdiutil`:

```bash
APP="packages/desktop/release/mac-arm64/Paseo.app"
STAGING="/tmp/paseo-dmg-staging"
DMG="packages/desktop/release/Paseo-<version>-arm64.dmg"
rm -rf "$STAGING" "$DMG"
mkdir -p "$STAGING"
cp -R "$APP" "$STAGING/"
ln -s /Applications "$STAGING/Applications"
hdiutil create -volname "Paseo" -srcfolder "$STAGING" \
    -fs HFS+ -format UDZO -imagekey zlib-level=9 -ov "$DMG"
rm -rf "$STAGING"
```

### 2e. Disk space check (CRITICAL)

DMG build needs ~3GB free (402MB `.app` + staging copy + final DMG). Check before building:

```bash
df -h / | tail -1   # Avail column must show >= 5Gi
```

If disk is full, the `.app` copy fails with `No space left on device` mid-build. Clean `~/.cache`, `~/.npm/_cacache`, `~/.gradle/caches`, old worktree `node_modules`, and old `release/` dirs before retrying.

### DMG output

```
packages/desktop/release/Paseo-<version>-arm64.dmg
packages/desktop/release/Paseo-<version>-arm64.zip   # also produced
packages/desktop/release/mac-arm64/Paseo.app           # the raw app
```

## Step 3 — Build APK (Android)

### 3a. Set env

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export PATH="$JAVA_HOME/bin:$PATH"
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export ANDROID_SDK_ROOT="$ANDROID_HOME"
```

### 3b. Build client (protocol + client workspace deps)

```bash
cd packages/app
npm --prefix ../.. run build:client
```

**CRITICAL — do not run DMG and APK builds in parallel.** The DMG script's `build:app-deps:clean` wipes `packages/client/dist/`, and the APK's `createBundleReleaseJsAndAssets` task needs `packages/client/dist/daemon-client.js` to exist. If they run in parallel, the APK bundle fails with:

```
Error: Unable to resolve module @getpaseo/client/internal/daemon-client from packages/app/src/runtime/host-runtime.ts
```

Run them sequentially, OR re-run `npm run build:client` immediately before the gradle step if you parallelized and hit this. The symptom is a 32-minute build that fails only at the final `:app:createBundleReleaseJsAndAssets` task with `node exit value 1`.

### 3c. expo prebuild (generates native android project)

```bash
APP_VARIANT=production npx expo prebuild --platform android --non-interactive --clean
```

`--clean` wipes `packages/app/android/` and regenerates it. This **destroys the aliyun patch in `android/build.gradle`** — re-run the Step 1 patcher after this.

### 3d. Re-patch aliyun (REQUIRED after prebuild --clean)

```bash
cd ../..
grep -rlE "gradlePluginPortal\(\)|google\(\)|mavenCentral\(\)" \
    packages/app/android --include="*.gradle" --include="*.gradle.kts" 2>/dev/null \
  | grep -vE "src/test|src/main" \
  | python3 scripts/patch-aliyun-mirror.py .
```

(`node_modules` patches survive prebuild — only `packages/app/android/build.gradle` is regenerated.)

### 3e. Build terminal webview (app-specific step)

```bash
cd packages/app && npm run build:terminal-webview
```

### 3f. gradle assembleRelease

```bash
cd android
./gradlew assembleRelease \
    -x lint -x lintVitalAnalyzeRelease -x lintVitalRelease \
    -x generateReleaseLintModel -x generateReleaseLintVitalModel \
    --continue
```

`--continue` keeps going past failures so you see all problems in one run, not one-at-a-time.

### 3g. Intermittent TLS failures (GFW retry strategy)

Even with aliyun mirrors, GFW occasionally blocks specific artifacts (e.g. `androidx.constraintlayout:constraintlayout:2.0.1`). The block is intermittent — the same URL fails on one run and succeeds on the next. Two recovery options:

1. **Just retry.** `./gradlew assembleRelease --continue` again. Gradle caches successful downloads in `~/.gradle/caches/modules-2/`, so each retry only re-attempts the failed ones. 3-4 retries usually clears it.

2. **Pre-download the specific artifact with curl, place it in the gradle cache.** Find the cache path:
   ```bash
   find ~/.gradle/caches/modules-2 -name "*constraintlayout*"
   ```
   Download the `.aar`/`.pom` with curl (curl bypasses the GFW Java-TLS block), place it at the expected cache path, and retry gradle.

Do **not** use a VPN/proxy unless the user has one running — the aliyun mirror + retry approach is more reliable than fighting the GFW directly.

### APK output

```
packages/app/android/app/build/outputs/apk/release/app-release.apk
```

Install on a device:

```bash
adb install -r packages/app/android/app/build/outputs/apk/release/app-release.apk
```

## Step 4 — Verify artifacts

```bash
# DMG exists and is non-trivial size (>100MB)
ls -lh packages/desktop/release/Paseo-*.dmg

# APK exists and is non-trivial size (>20MB)
ls -lh packages/app/android/app/build/outputs/apk/release/*.apk

# (optional) mount the DMG and launch to confirm it boots
open packages/desktop/release/Paseo-*.dmg
```

## Full build scripts (run SEQUENTIALLY — DMG first, then APK)

**Do not run in parallel** — DMG's `build:app-deps:clean` wipes `packages/client/dist/` which APK's bundle task needs. Run DMG to completion, then APK. Save as `/tmp/paseo-dmg-build.sh` and `/tmp/paseo-apk-build.sh`:

### DMG script

```bash
#!/usr/bin/env bash
set -e
cd <repo-root>
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run build:app-deps:clean
(cd packages/app && PASEO_WEB_PLATFORM=electron npx expo export --platform web)
npm run build:server:clean
(cd packages/desktop && npm run build:main)
(cd packages/desktop && CSC_IDENTITY_AUTO_DISCOVERY=false \
    npx electron-builder --config electron-builder.yml -c.mac.notarize=false --mac)
# If dmgbuild crashed, the manual hdiutil fallback (Step 2d) runs here.
ls -lh packages/desktop/release/
```

### APK script

```bash
#!/usr/bin/env bash
set -e
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export PATH="$JAVA_HOME/bin:$PATH"
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export ANDROID_SDK_ROOT="$ANDROID_HOME"
cd <repo-root>/packages/app
npm --prefix ../.. run build:client
APP_VARIANT=production npx expo prebuild --platform android --non-interactive --clean
# Re-patch aliyun after prebuild --clean
cd ../..
grep -rlE "gradlePluginPortal\(\)|google\(\)|mavenCentral\(\)" \
    packages/app/android --include="*.gradle" --include="*.gradle.kts" 2>/dev/null \
  | grep -vE "src/test|src/main" \
  | python3 scripts/patch-aliyun-mirror.py .
cd packages/app
npm run build:terminal-webview
cd android
./gradlew assembleRelease -x lint -x lintVitalAnalyzeRelease -x lintVitalRelease \
    -x generateReleaseLintModel -x generateReleaseLintVitalModel --continue
find . -path "*/outputs/apk/release/*.apk" -print
```

## What NOT to do

- **Do not run `npm run release:*`.** That bumps versions, publishes to npm, pushes tags, and triggers CI. This is local-only.
- **Do not run `eas build`.** That's cloud build, costs EAS minutes, and submits to stores. Local `./gradlew assembleRelease` produces the same APK without EAS.
- **Do not skip the aliyun patch in China.** Every "Remote host terminated the handshake" / "TLS protocol versions" error on gradle is the GFW. The patch is mandatory, not optional.
- **Do not forget to re-patch after `expo prebuild --clean`.** This is the most common reason a previously-working APK build suddenly fails again.
- **Do not build on the wrong branch.** Verify HEAD has your code before starting. `git worktree list` + `git log -1` first.
- **Do not run the full test suite.** Build artifacts don't need tests. `npm run typecheck` is the only sanity check worth running, and only if you're unsure the branch compiles.

## Cleanup

The build leaves behind large directories that can be deleted after the artifacts are extracted:

```bash
rm -rf packages/app/android                              # ~1GB, regenerated by prebuild
rm -rf packages/desktop/release/mac-arm64                # 402MB, the raw .app
rm -rf packages/app/android/app/build/outputs/apk/release/*.apk  # KEEP THIS — it's the artifact
# ~/.gradle/caches and ~/.npm/_cacache can be cleaned if disk is tight, but they speed up the next build
```

## Failure mode reference

| Symptom                                                                                                           | Cause                                                                             | Fix                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `cross-env: command not found` in nohup shell                                                                     | detached shell PATH lacks node_modules/.bin                                       | Use `PASEO_WEB_PLATFORM=electron npx expo export` directly (no cross-env)                                    |
| `Could not get resource 'https://release-assets.githubusercontent.com/...'` EOF                                   | GFW blocks electron download                                                      | Set `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`                                                |
| `Response code 404 for dmg-builder@1.2.0` from npmmirror                                                          | npmmirror doesn't mirror electron-builder-binaries                                | Unset `ELECTRON_BUILDER_BINARIES_MIRROR`, let it use github (cached at `~/Library/Caches/electron-builder/`) |
| `plistlib.InvalidFileException: Invalid file` in dmgbuild                                                         | macOS Tahoe + Python 3.14 hdiutil plist bug                                       | Use manual `hdiutil create` (Step 2d)                                                                        |
| `No space left on device` during `.app` copy                                                                      | disk full                                                                         | Clean `~/.cache`, old worktrees, retry (Step 2e)                                                             |
| `Remote host terminated the handshake` on `plugins.gradle.org` / maven central                                    | GFW blocks Java TLS clients                                                       | aliyun patch (Step 1) + `~/.gradle/init.d/aliyun-mirror.gradle`                                              |
| `Unresolved reference: maven` in `.kts` after patch                                                               | patcher injected into single-line block wrong                                     | Re-run fixed patcher (handles `repositories { x }` correctly)                                                |
| `Could not resolve ... after prebuild`                                                                            | prebuild `--clean` overwrote `android/build.gradle` patch                         | Re-run patcher after prebuild (Step 3d)                                                                      |
| `:react-native-screens:configureNdkBuild FAILED` mid-build but earlier tasks passed                               | GFW intermittent block on one artifact                                            | Retry `./gradlew assembleRelease --continue` 2-3 times                                                       |
| `:app:createBundleReleaseJsAndAssets FAILED` / `Unable to resolve module @getpaseo/client/internal/daemon-client` | DMG's `build:app-deps:clean` wiped `packages/client/dist/` while APK was bundling | Re-run `npm run build:client`, then retry gradle. Don't parallelize DMG + APK.                               |
