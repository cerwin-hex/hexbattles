# Hex Battles — Google Play Store Build Guide

This guide explains how to build the `.aab` file you need to upload to Google Play Store.

## Prerequisites

1. **An Expo account** (free) — create one at https://expo.dev
2. **A Google Play Developer account** — one-time $25 fee at https://play.google.com/console

---

## Step 1 — Install EAS CLI

```bash
npm install -g eas-cli
```

## Step 2 — Navigate to the app folder

```bash
cd path/to/Hex-Battles/artifacts/hex-battles
```

## Step 3 — Log in to Expo

```bash
eas login
```

## Step 4 — Install dependencies

```bash
pnpm install
```

---

## Step 5 — Build the .aab file for Google Play

```bash
eas build --platform android --profile production
```

- The build runs in Expo's cloud — your computer does not need Android Studio.
- It takes approximately **10–20 minutes**.
- EAS will automatically generate and manage your signing keystore on the first build. **Keep this keystore safe** — you need it for all future updates.

## Step 6 — Download the .aab file

When the build finishes, EAS will print a download link in the terminal. Download it with this command (the build ID is shown at the end of the build):

```bash
eas build:download --id BUILD_ID_FROM_TERMINAL
```

Or find all builds at the web dashboard:

https://expo.dev/accounts/YOUR_USERNAME/projects/hex-battles/builds

## Step 7 — Upload to Google Play Console

1. Go to https://play.google.com/console
2. Create a new app (name: **Hex Battles**, package: `dk.hextek.hexbattles`)
3. Go to **Production → Releases → Create new release**
4. Upload the `.aab` file
5. Fill in the release notes and submit for review

---

## Optional: Build a test APK (side-loadable)

```bash
eas build --platform android --profile preview
```

This produces an `.apk` file you can install directly on any Android device.

---

## App details

| Field | Value |
|-------|-------|
| Package name | `dk.hextek.hexbattles` |
| Version | 1.0.0 |
| Version code | 1 |

> **Note:** Bump `versionCode` by 1 (e.g. 2, 3, ...) in `app.json` for every new release you upload to Google Play.
