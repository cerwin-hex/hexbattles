# Hex Battle — Google Play Store Build Guide

This guide explains how to build the `.aab` file you need to upload to Google Play Store.

## Prerequisites

1. **Node.js** installed on your computer (https://nodejs.org)
2. **An Expo account** (free) — create one at https://expo.dev
3. **A Google Play Developer account** — one-time $25 fee at https://play.google.com/console

---

## Step 1 — Download the project

Download this project from Replit as a ZIP file (use the three-dot menu → Download as ZIP), then unzip it on your computer.

## Step 2 — Install EAS CLI

Open a terminal and run:

```bash
npm install -g eas-cli
```

## Step 3 — Navigate to the app folder

```bash
cd path/to/project/artifacts/hex-strategy
```

## Step 4 — Log in to Expo

```bash
eas login
```

Enter your Expo account email and password.

## Step 5 — Install dependencies

```bash
npm install
```

## Step 5b — Set your production domain in app.json

Open `app.json` and find this line:

```json
"origin": "https://YOUR-DEPLOYED-DOMAIN.replit.app/"
```

Replace `YOUR-DEPLOYED-DOMAIN` with the actual domain of your deployed Replit app (the one you publish to, ending in `.replit.app`). This tells the app where your API server lives in production.

If you have not deployed the app yet, deploy it first from Replit, then copy the domain here before building.

---

## Step 6 — Build the .aab file for Google Play

```bash
eas build --platform android --profile production
```

- The build runs in Expo's cloud — your computer does not need Android Studio.
- It takes approximately **10–20 minutes**.
- EAS will automatically generate and manage your signing keystore on the first build. **Keep this keystore safe** — you need it for all future updates.

## Step 7 — Download the .aab file

When the build finishes, EAS will print a download link in the terminal. Download it with this command (the build ID is shown at the end of the build):

```bash
eas build:download --id BUILD_ID_FROM_TERMINAL
```

Or you can find all your builds and download from the web dashboard:

https://expo.dev/accounts/YOUR_USERNAME/projects/hex-strategy/builds

## Step 8 — Upload to Google Play Console

1. Go to https://play.google.com/console
2. Create a new app (name: **Hex Battle**, package: `com.hextek.hexbattles`)
3. Go to **Production → Releases → Create new release**
4. Upload the `.aab` file
5. Fill in the release notes and submit for review

---

## Optional: Build a test APK (side-loadable)

If you want to test on a device before publishing:

```bash
eas build --platform android --profile preview
```

This produces an `.apk` file you can install directly on any Android device.

---

## App details

| Field | Value |
|-------|-------|
| Package name | `com.hextek.hexbattles` |
| Version | 1.0.0 |
| Version code | 1 |

> **Note:** Bump `versionCode` by 1 (e.g. 2, 3, ...) in `app.json` for every new release you upload to Google Play.
