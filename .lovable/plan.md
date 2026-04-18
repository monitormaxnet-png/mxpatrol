

## What the logs actually tell us

The logs you pasted are **Android system surface/rendering messages** from the OS — not from our NFC code. Specifically:
- `surfaceflinger ... No local sync point found` — harmless WindowManager animation noise.
- `GED ged_boost_gpu_freq` — GPU frequency boost during animation.

There is **no NFC log line at all**. That means one of two things:
1. The native NFC plugin was never bundled into the APK you installed, OR
2. `nfcReader.startScanning()` is never being called (button blocked because no guard is selected, or the hook short-circuits to `unsupported`).

## Most likely root cause

Looking at `package.json` from our last change, we added `@exxili/capacitor-nfc`. **But the APK currently installed on the RG360 (`com.monitormaxnet.mxpatrol`) was built before that plugin was added.** Capacitor plugins must be present at native build time — they cannot be hot-reloaded from the server URL.

Your current `capacitor.config.ts` points `server.url` at `https://mxpatrol.lovable.app`, so the WebView loads the latest JS — but the **native bridge for NFC doesn't exist in the APK binary**. When `useNfcReader` calls `import("@exxili/capacitor-nfc")` and then `NFC.startScan(...)`, Capacitor responds with "plugin not implemented" and the catch block sets `status = "error"` silently.

There's also a second issue: the package name in your logs is `com.monitormaxnet.mxpatrol`, but our `capacitor.config.ts` has `appId: app.lovable.7a762bd665c04e6d941783744dd932b0`. So the APK on your device was built from a **different Capacitor project** (likely an earlier/separate setup), not from the config we just committed.

## Plan to fix

### Step 1 — Add visible diagnostics (so we stop guessing)
Add a small debug panel to the NFC Scanner page (toggle behind a long-press or `?debug=1` query) that shows:
- `isNative` (Capacitor detected?)
- `supported` value
- `nfcReader.status`
- `nfcReader.errorMessage`
- Plugin import success/failure

This will let you tell us in one screenshot exactly where the chain breaks on the RG360.

### Step 2 — Confirm correct APK build steps
Whoever builds the APK must, **after pulling the latest code**:
```bash
npm install
npx cap sync android      # critical — copies the plugin native code into android/
cd android && ./gradlew assembleDebug
```
If they skip `cap sync`, the new plugin never enters the APK.

### Step 3 — Align the Android package name
Decide whether the production APK should be `com.monitormaxnet.mxpatrol` (current installed binary) or `app.lovable.7a762bd665c04e6d941783744dd932b0` (our config). I recommend keeping `com.monitormaxnet.mxpatrol` — update `capacitor.config.ts` to match so future builds stay on the same package and don't show up as a separate app on the device.

### Step 4 — Harden `useNfcReader` for native failures
Currently when the native plugin isn't available, the catch block sets `status = "error"` with a generic message. Change it to:
- Detect "plugin not implemented" specifically and set `status = "unsupported"` with message: *"NFC plugin missing from this APK build. Rebuild with `npx cap sync android`."*
- Log the underlying error to console so it shows up in `adb logcat | grep -i nfc`.

### Step 5 — Verify NDEF vs. tag UID format on RG360
The RG360 is typically used with MIFARE Classic / NTAG tags. The `@exxili/capacitor-nfc` plugin returns tag info under `tagInfo.uid`. Our hook already reads that, but we should also add a fallback path for `data.uid` (some plugin versions flatten it) so we don't silently drop reads.

## Files to change

- `capacitor.config.ts` — change `appId` to `com.monitormaxnet.mxpatrol`
- `src/hooks/useNfcReader.ts` — better error classification + log to console
- `src/pages/NFCScanner.tsx` — add `?debug=1` diagnostic overlay
- Memory: update `mem://features/nfc-hardware-scanner` with the rebuild requirement

## What we need from you after the change

1. Pull → `npm install` → `npx cap sync android` → rebuild APK → reinstall.
2. Open the scanner with `https://mxpatrol.lovable.app/nfc-scanner?debug=1`.
3. Send a screenshot of the diagnostic panel + the output of `adb logcat | grep -iE "nfc|capacitor"` while tapping a tag.

That will tell us definitively whether the plugin is registered and what it's seeing from the hardware.

