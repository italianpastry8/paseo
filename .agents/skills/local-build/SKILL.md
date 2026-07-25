---
name: local-build
description: Build local DMG and APK artifacts of Paseo (bypassing release/CI). Use when the user says "build dmg", "build apk", "编译 dmg", "编译 apk", "本地编译", or wants runnable installers for personal use without a formal release. Handles GFW network blocks on Java/gradle TLS, the macOS Tahoe dmgbuild bug, and the macOS 26 Electron Framework codesign Team ID mismatch. Produces unsigned, unnotarized artifacts in packages/desktop/release/ and packages/app/android/app/build/outputs/apk/release/.
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
- User is on macOS 26+ (Tahoe) where Electron Framework ad-hoc signatures have mismatched Team IDs, causing `SIGABRT` on launch.

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

> **CRITICAL ORDERING — read before running Step 2.** The three sub-steps below MUST run in this exact order: **2c (electron-builder) → 2d (re-sign .app) → 2e (rebuild DMG via hdiutil)**. `electron-builder --mac` produces the `.app` AND the `.dmg` in one atomic command, but that DMG is **always invalid on macOS 26** — it embeds the un-re-signed `.app` whose Electron Framework has a mismatched Team ID. Re-signing the `.app` afterward (2d) fixes only the copy on disk; the DMG still holds the broken app. You MUST rebuild the DMG from the re-signed `.app` via `hdiutil` (2e). Skipping 2e produces a DMG that installs an app which `SIGABRT`s on launch. This is the #1 way agents get this build wrong.

### 2c. electron-builder (unsigned, notarize off)

```bash
(cd packages/desktop && \
  CSC_IDENTITY_AUTO_DISCOVERY=false \
  npx electron-builder --config electron-builder.yml -c.mac.notarize=false --mac)
```

`CSC_IDENTITY_AUTO_DISCOVERY=false` disables code signing (no Apple Developer ID needed). `-c.mac.notarize=false` overrides the `notarize: true` in `electron-builder.yml`.

This produces `packages/desktop/release/mac-arm64/Paseo.app` plus a `.dmg` and `.zip`. **The `.dmg` and `.zip` electron-builder emits are throwaway on macOS 26** — they contain the un-re-signed `.app` and will be replaced in 2e. You only keep the `.app` from this step.

### 2d. Re-sign the .app (macOS 26 Tahoe codesign Team ID mismatch — REQUIRED)

macOS 26 (Tahoe) enforces strict code-signing Team ID checks on Electron Framework. The ad-hoc signature produced by electron-builder (with `CSC_IDENTITY_AUTO_DISCOVERY=false`) gives the main executable and the bundled `Electron Framework.framework` different Team IDs, causing a crash on launch:

```
Library not loaded: @rpath/Electron Framework.framework/Electron Framework
...code signature in ... not valid for use in process: mapping process and mapped file
(non-platform) have different Team IDs
```

Re-sign the `.app` electron-builder just produced:

```bash
APP="packages/desktop/release/mac-arm64/Paseo.app"
xattr -cr "$APP"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"   # must print nothing (success)
```

`xattr -cr` strips quarantine/extended attributes that can interfere with re-signing. `codesign --force --deep --sign -` applies a single ad-hoc identity to every framework and helper inside the bundle, resolving the Team ID mismatch. Verify the signature before proceeding to 2e.

Re-signing is **necessary but not sufficient** — it fixes the `.app` on disk only. The DMG from 2c still embeds the broken app, so you must proceed to 2e.

### 2e. Build the final DMG from the re-signed .app (MANDATORY, always run — never skip)

**Always** build the DMG yourself via `hdiutil` from the re-signed `.app`. Do this every build, not just as a fallback. This guarantees the DMG contains the fixed signature, and it sidesteps the `dmgbuild` plist crash entirely (electron-builder's DMG is discarded).

First, check disk space — the DMG step needs ~3GB free (402MB `.app` + staging copy + final DMG):

```bash
df -h / | tail -1   # Avail column must show >= 5Gi
```

If disk is full, the `.app` copy fails with `No space left on device` mid-build. Clean `~/.cache`, `~/.npm/_cacache`, `~/.gradle/caches`, old worktree `node_modules`, and old `release/` dirs before retrying.

Then read the version from `packages/desktop/package.json` and build the DMG:

```bash
APP="packages/desktop/release/mac-arm64/Paseo.app"
STAGING="/tmp/paseo-dmg-staging"
DMG="packages/desktop/release/Paseo-<version>-arm64.dmg"   # read <version> from packages/desktop/package.json
rm -rf "$STAGING" "$DMG"
mkdir -p "$STAGING"
cp -R "$APP" "$STAGING/"
ln -s /Applications "$STAGING/Applications"
hdiutil create -volname "Paseo" -srcfolder "$STAGING" \
    -fs HFS+ -format UDZO -imagekey zlib-level=9 -ov "$DMG"
rm -rf "$STAGING"
```

This replaces the invalid DMG electron-builder produced in 2c. The `dmgbuild` plist crash (below) is now moot — you never use electron-builder's DMG.

> Historical note: `dmgbuild` (used by electron-builder) crashes on macOS Tahoe + Python 3.14 with `plistlib.InvalidFileException: Invalid file at .../dmgbuild/core.py line 60, in hdiutil`. When this build used electron-builder's DMG, that crash was a problem; now that 2e always rebuilds via raw `hdiutil`, it no longer matters.

If you shipped a DMG without 2e and the installed app `SIGABRT`s, you can recover without a full rebuild:

- Re-sign the installed `/Applications/Paseo.app` directly (quick fix for the current install): `xattr -cr /Applications/Paseo.app && codesign --force --deep --sign - /Applications/Paseo.app`
- Rebuild a clean distributable DMG from the already-re-signed `.app` in `packages/desktop/release/mac-arm64/` using the `hdiutil` command above.

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

# CRITICAL — size alone does NOT prove the DMG is valid. The #1 DMG failure mode
# is a correctly-sized DMG that installs an app which SIGABRTs on launch because
# the embedded .app was never re-signed. Confirm it actually boots:
APP="packages/desktop/release/mac-arm64/Paseo.app"
codesign --verify --deep --strict "$APP" || echo "RE-SIGN FAILED (Step 2d)"
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
# 2c — electron-builder produces .app + a THROWAWAY .dmg/.zip (DMG is invalid on macOS 26)
(cd packages/desktop && CSC_IDENTITY_AUTO_DISCOVERY=false \
    npx electron-builder --config electron-builder.yml -c.mac.notarize=false --mac)
# 2d — re-sign the .app to fix macOS 26 Tahoe Team ID mismatch (REQUIRED)
APP="packages/desktop/release/mac-arm64/Paseo.app"
xattr -cr "$APP" && codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP" && echo "codesign OK"
# 2e — rebuild the final DMG from the re-signed .app (MANDATORY, never skip).
# The DMG electron-builder produced above embeds the un-re-signed app and SIGABRTs on launch.
VER=$(node -p "require('./packages/desktop/package.json').version")
DMG="packages/desktop/release/Paseo-${VER}-arm64.dmg"
STAGING="/tmp/paseo-dmg-staging"
rm -rf "$STAGING" "$DMG"
mkdir -p "$STAGING"
cp -R "$APP" "$STAGING/"
ln -s /Applications "$STAGING/Applications"
hdiutil create -volname "Paseo" -srcfolder "$STAGING" \
    -fs HFS+ -format UDZO -imagekey zlib-level=9 -ov "$DMG" >/dev/null 2>&1
rm -rf "$STAGING"
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

| Symptom                                                                                                              | Cause                                                                                                  | Fix                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `cross-env: command not found` in nohup shell                                                                        | detached shell PATH lacks node_modules/.bin                                                            | Use `PASEO_WEB_PLATFORM=electron npx expo export` directly (no cross-env)                                    |
| `Could not get resource 'https://release-assets.githubusercontent.com/...'` EOF                                      | GFW blocks electron download                                                                           | Set `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`                                                |
| `Response code 404 for dmg-builder@1.2.0` from npmmirror                                                             | npmmirror doesn't mirror electron-builder-binaries                                                     | Unset `ELECTRON_BUILDER_BINARIES_MIRROR`, let it use github (cached at `~/Library/Caches/electron-builder/`) |
| `plistlib.InvalidFileException: Invalid file` in dmgbuild                                                            | macOS Tahoe + Python 3.14 hdiutil plist bug                                                            | Moot — 2e always rebuilds the DMG via raw `hdiutil`; electron-builder's DMG is discarded                     |
| `No space left on device` during `.app` copy                                                                         | disk full                                                                                              | Clean `~/.cache`, old worktrees, retry (Step 2e pre-check)                                                   |
| `Remote host terminated the handshake` on `plugins.gradle.org` / maven central                                       | GFW blocks Java TLS clients                                                                            | aliyun patch (Step 1) + `~/.gradle/init.d/aliyun-mirror.gradle`                                              |
| `Unresolved reference: maven` in `.kts` after patch                                                                  | patcher injected into single-line block wrong                                                          | Re-run fixed patcher (handles `repositories { x }` correctly)                                                |
| `Could not resolve ... after prebuild`                                                                               | prebuild `--clean` overwrote `android/build.gradle` patch                                              | Re-run patcher after prebuild (Step 3d)                                                                      |
| `:react-native-screens:configureNdkBuild FAILED` mid-build but earlier tasks passed                                  | GFW intermittent block on one artifact                                                                 | Retry `./gradlew assembleRelease --continue` 2-3 times                                                       |
| `:app:createBundleReleaseJsAndAssets FAILED` / `Unable to resolve module @getpaseo/client/internal/daemon-client`    | DMG's `build:app-deps:clean` wiped `packages/client/dist/` while APK was bundling                      | Re-run `npm run build:client`, then retry gradle. Don't parallelize DMG + APK.                               |
| `EXC_CRASH (SIGABRT)` / `different Team IDs` on launch — but the source `.app` in `release/mac-arm64/` verifies fine | Re-sign (2d) ran but DMG was never rebuilt (2e skipped); the DMG still embeds the un-re-signed app     | **Run 2e** — rebuild the DMG from the re-signed `.app` via `hdiutil`. Re-sign alone is insufficient.         |
| `EXC_CRASH (SIGABRT)` / `Library not loaded: @rpath/Electron Framework.framework` / `different Team IDs` on launch   | macOS 26 Tahoe enforces Team ID match; ad-hoc sign gives Framework a different ID than the main binary | `xattr -cr <app>` then `codesign --force --deep --sign - <app>` (Step 2d), then rebuild DMG (Step 2e).       |
