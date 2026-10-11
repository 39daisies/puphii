# Puphii — Privacy, security and pre-launch audit

Audit date: 2026-10-10 · App version 0.1.0 · Expo SDK 57 / React Native 0.86.3

This is an engineering readiness review, not legal advice or a legal certification. It does not guarantee that Puphii complies with any law or will pass App Store review. Items marked **Owner decision** or **Verify** need a person with authority (and, where noted, legal advice) to close them.

## 1. Scope and method

Reviewed:

- All application code (`App.tsx`, `src/**`), tests, `app.json`, `package.json` and `package-lock.json`.
- Every installed native module, its iOS/Android sources, privacy manifests and Expo config plugins.
- The native projects Expo would generate for a store build. These were produced with `npx expo prebuild --no-install --clean` in a scratch copy, and the resulting `Info.plist`, entitlements, `PrivacyInfo.xcprivacy` and `AndroidManifest.xml` were inspected. Pods and Gradle were **not** installed or compiled, so manifest merging and privacy-manifest aggregation at build time are not yet verified.
- All user-facing copy, including notification text, Learn content and the About page.
- Font, image and sound assets.

Searches covered `fetch`, `XMLHttpRequest`, `WebSocket`, URLs, `console.*`, `Linking`, analytics/crash/attribution SDK names, device identifiers, push tokens and permission requests.

## 2. Data inventory

| Data | Where it lives | Leaves the device? |
|---|---|---|
| Puff logs (random ID + ISO timestamp per tap) | AsyncStorage key `@puphii/puff-logs-v1` | No |
| Settings (reaction mode, sound, haptics, reminder on/off and time) | AsyncStorage key `@puphii/settings-v1` | No |
| Savings calculator inputs (product type, prices, usage, currency, reduction percentage, optional goal name and amount). No bank, card or other financial account details. | AsyncStorage key `@puphii/savings-v1` | No |
| Bubble Break record (number of completed rounds and best score). Individual rounds and taps are not stored. | AsyncStorage key `@puphii/bubble-break-v1` | No |
| App lifecycle state (first launch time and how it was recorded, onboarding completion, experiment assignments; currently none). Kept by "Reset everything". | AsyncStorage key `@puphii/app-state-v1` | No |
| Storage schema version | AsyncStorage key `@puphii/schema` | No |
| Set-aside copies of data that was unreadable (`corrupt`), had values this version couldn't use (`invalid`), or was about to be changed by a migration (`premigration`). Deleted with the data they copy. | AsyncStorage keys `…-<reason>-<timestamp>` | No |
| Daily reminder | iOS/Android local notification scheduler | No (local notifications do not use APNs/FCM) |

Puff logs are sensitive even though they stay local: they reveal smoking or vaping behaviour and its timing. Puphii **processes** this information on the device. It does not **collect** it in the App Store sense (transmitting it off the device), because no code path sends it anywhere.

The daily count uses the device's local calendar date (`localDayKey`), which is covered by unit tests across five time zones and DST transitions. Logs are kept until the user deletes them individually, clears history or resets the app.

## 3. Network and third-party inventory

Puphii's own code makes no network requests. There is no backend, account, cloud sync, analytics, advertising, attribution, crash reporting or remote logging, and none of those SDKs are installed. The RevenueCat subscription SDK (below) starts whenever a build has a valid public SDK key: the iOS `appl_` key is supplied through EAS environment variables, so store builds made with it **do** contact RevenueCat and the App Store at launch to read subscription status, and the Puphii Pro paywall (subscription phase 3) buys and restores through it.

| Dependency | Network behaviour found | Conclusion |
|---|---|---|
| `expo-notifications` | Contains code that posts a device push token to `exp.host`, but only after `getExpoPushTokenAsync` or `setAutoServerRegistrationEnabledAsync` is called. Puphii calls neither, and only loads the module when the user turns reminders on. | No transmission. |
| `expo-notifications` (Android) | Links `firebase-messaging`. Firebase does not initialise without a `google-services.json`, which Puphii does not have. | No transmission on Android as configured. Re-check if Firebase is ever added. |
| `react-native-purchases` (RevenueCat) | Once configured, talks to RevenueCat's servers and the App Store / Google Play to read subscription status. It sends an anonymous RevenueCat user ID (random, not linked to an account), store transactions and receipts, and app, SDK, OS and storefront details, plus the usual request metadata such as IP address. Puphii passes no puff logs, settings, savings or game data. Its iOS privacy manifest declares Purchase History (not linked, not tracking). RevenueCat iOS 5.94.0 also sends the device's vendor identifier (IDFV, `X-Apple-Device-Identifier`), device model, OS and app versions, locales and storefront country in request headers. | **Active in builds with a key.** The app's privacy manifest now declares Purchase History (not linked, no tracking, App Functionality). The App Privacy label needs Purchases → Purchase History, and the privacy policy must name RevenueCat. **Verify** with RevenueCat or a qualified reviewer whether the IDFV header requires an Identifiers → Device ID disclosure. **Verify** the Android Play Billing permission in the first Android build. |
| RevenueCat Test Store (development) | Development builds can use a Test Store key to simulate purchases from a developer-menu screen. The key and the screen are excluded from release bundles (verified by exporting production bundles with a key set), store key variables refuse Test Store keys, and RevenueCat's native SDK crashes release builds configured with one. Nothing is charged; RevenueCat records the purchases as sandbox data under the anonymous ID. | Development only. |
| `expo-dev-client` | Development builds only: discovers and connects to the developer's Metro server on the local network (adds local-network and Bonjour keys, which its build phase strips from Release builds). Not included in store builds. | Development only. |
| `react-native-svg` | `SvgUri`/remote CSS can fetch URLs. Puphii only uses inline SVG. | No transmission. |
| `expo-audio`, `expo-haptics`, `expo-font`, AsyncStorage, safe-area-context | Local only. Fonts and the sound are bundled, not downloaded. | No transmission. |
| `expo-application`, `expo-constants` (transitive) | Can read identifiers such as IDFV, but Puphii never calls those APIs. | No transmission. |
| Learn "Sources" links | `Linking.openURL` opens cdc.gov, smokefree.gov or nhs.uk in the system browser when the user taps a link. Those sites receive a normal web request (IP address, browser details) and may set cookies under their own policies. Puphii passes no user data in the URL. | User-initiated. Mention in the privacy policy. |

Development-only tooling (Expo Go, Metro, Expo CLI telemetry, the React Native dev menu) is not part of a release build.

## 4. Permissions and capabilities (store build)

| Item | Before audit | After audit |
|---|---|---|
| iOS notification permission | Requested only when the user turns reminders on | Unchanged |
| iOS `NSMicrophoneUsageDescription` | Added by the `expo-audio` plugin default | **Removed** (`microphonePermission: false`). `expo-audio` resolves its record-permission selector at runtime, so Apple's missing-purpose-string scan should not trigger. **Verify** on first TestFlight upload. |
| iOS `UIBackgroundModes: audio` | Added by `expo-audio` default (`enableBackgroundPlayback`) | **Removed**. Puphii only plays a short sound while open. |
| iOS `aps-environment` (push) entitlement | Added by the auto-applied `expo-notifications` plugin | **Removed** via `plugins/withoutPushEntitlement.js`. Local reminders do not need it. |
| iOS privacy manifest | Not declared at app level | **Declared** in `app.json`: no tracking, no tracking domains, Purchase History collected for app functionality (not linked, no tracking; added with the paywall, matching RevenueCat's manifest), plus required-reason APIs used by React Native (UserDefaults CA92.1, file timestamps C617.1, system boot time 35F9.1). React Native merges library manifests into it during `pod install`. **Verify** the merged file in the first native build. |
| iOS export compliance | Not declared | `ITSAppUsesNonExemptEncryption = false` (Puphii implements no encryption). |
| App Transport Security | Arbitrary loads disabled | Unchanged |
| Android `RECORD_AUDIO` | Added by `expo-audio` | **Removed** and blocked |
| Android external storage, `SYSTEM_ALERT_WINDOW` | Template defaults | **Blocked** |
| Android `android:allowBackup` | `true` (puff logs would go into Google auto-backup) | **`false`** |
| Android remaining | `INTERNET` (React Native runtime), `VIBRATE` (haptics), `MODIFY_AUDIO_SETTINGS` (expo-audio), `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED` (reminders) | Kept; each has a purpose. Android is not the launch target. |

No location, contacts, camera, microphone, photos, health, tracking (ATT) or other sensitive permission is requested.

## 5. Backups

- **iOS:** AsyncStorage marks its storage folder `NSURLIsExcludedFromBackupKey` by default (`RCTAsyncStorageExcludeFromBackup` is not overridden). Puff logs are therefore not in iCloud or computer backups, and deleting the app deletes them. This also means logs do not survive a device change; the in-app copy now says so.
- **Android:** `allowBackup` is now `false`.
- **Web:** not a launch target; data is in browser `localStorage`.

## 6. Logging

- The only app log is `console.error` when bundled fonts fail to load; it contains the font error, not user data.
- Development builds also log the subscription status (for example "notConfigured"), and RevenueCat logs at debug level. Release builds keep RevenueCat at warning level and do not log the status.
- AsyncStorage's native logs report storage errors without stored values.
- No puff records, timestamps or counts are logged anywhere.

## 7. Findings and changes

| # | Finding | Severity | Status |
|---|---|---|---|
| F1 | "Clear puff history" and "Reset everything" left set-aside copies of unreadable data (`…-corrupt-…`) on the device, so deletion was incomplete. | High | **Fixed.** Clear removes log copies; Reset removes log and settings copies. Failure shows an error; success dismisses the "backup was kept" banner. Unit-tested, and verified end-to-end on web. |
| F2 | `expo-audio` defaults added a microphone purpose string, background audio mode and Android `RECORD_AUDIO`. | High (review and permission hygiene) | **Fixed** in `app.json`; confirmed in generated native projects. |
| F3 | Unneeded push entitlement from `expo-notifications`. | Medium | **Fixed** with a local config plugin; confirmed in generated entitlements. |
| F4 | Android auto-backup would copy puff logs to Google Drive. | Medium (Android) | **Fixed** (`allowBackup: false`). |
| F5 | Reminder text ("Log puffs whenever you're ready") would reveal smoking/vaping on the lock screen. | Medium | **Fixed.** Now "Puphii — Your daily check-in is here." |
| F6 | Data screen said "Everything stays on this device", without mentioning backups or that deleting the app deletes the data. | Low | **Fixed** with platform-specific, accurate copy. Storage errors are now shown on the Data screen too. |
| F7 | Learn "What changes when you quit" lists population-level CDC findings that could read as a personal recovery prediction. | Low | **Fixed.** Added that these are general findings for people who stop smoking cigarettes, not a prediction for any one person. |
| F8 | No app-level privacy manifest or export-compliance key. | Low | **Fixed** (see section 4). |
| F9 | No privacy policy exists, in the app or as a public URL. Apple requires a privacy policy link in App Store Connect and an easily accessible link in the app. | High (blocks submission) | **Open.** Needs owner-approved text and hosting. |
| F10 | Font licences: Inter and Fraunces are SIL OFL 1.1. Inter's TTF carries the licence in its metadata; the modified Fraunces instance's licence lives in `assets/fonts/Fraunces-OFL.txt`, which is not shown in the app. Fraunces declares no Reserved Font Name, so the renamed instance is permitted. | Low | **Open.** Add an in-app acknowledgements/licences screen including both OFL notices. |
| F11 | Mascot images were supplied by the product owner; their origin and usage rights are not documented in the project. | Medium | **Owner decision.** Confirm ownership or licence (including any image-generator terms) before release and before trademark use. |
| F12 | Provenance of the original `bubble-pop.wav` was not documented. | Low | **Fixed.** Replaced by `assets/sounds/bubble-bloop.wav`, synthesised from scratch by `scripts/generate-bubble-sounds.py` (no samples or third-party audio). |
| F13 | App Review guideline 1.4.3 does not allow apps that encourage tobacco or vape consumption. Puphii is a tracking tool with disapproving reactions, but the "+1" framing and the Minimal mode's winking face could be read as approving. | Medium (review risk) | **Owner decision.** Consider neutral Minimal faces and describe the app in review notes as habit awareness. |
| F14 | About tagline "Don't just count it. Count it scared." is a fear appeal. Not a health claim, but marketing tone matters for review and for consumer-protection rules on advertising. | Low | **Owner decision.** |
| F15 | Expressive mode includes a coughing face, which depicts a physical symptom. Disclaimers state faces are not health measurements. | Low | **Owner decision.** |
| F16 | Learn content and sources are English and US/UK-based. | Medium for Japan | **Open.** Japanese localisation and Japanese public-health sources (for example MHLW) before a Japan launch. |
| F17 | `npm audit` reports 22 advisories (15 high, 7 moderate, 0 critical); 23 after adding `react-native-purchases`, which npm flags only because it depends on `react-native` (its suggested "fix" is a downgrade). The high ones trace to two root packages: `braces`/`micromatch` (denial of service from crafted glob patterns, used by Metro and the Expo CLI at build time) and `node-forge` (used by Expo's code-signing tooling). Neither is part of the app's runtime bundle, and the app processes no untrusted input with them. | Low for users; relevant for the build machine | **Open.** Upgrade when Expo ships patched versions; do not run `npm audit fix --force`, which would break the SDK version set. |

## 8. App Store readiness notes

- **App Privacy ("nutrition label"):** "Data Not Collected" is **no longer accurate** for builds with a RevenueCat key. At minimum, declare Purchases → Purchase History (not linked to identity, not used for tracking, App Functionality). Whether the IDFV RevenueCat sends needs Identifiers → Device ID is open (see section 3). Puff logs, settings, savings and game data are still not collected. **Owner decision** in App Store Connect.
- **Privacy policy:** required (F9). It should explain on-device storage, the backup exclusion, deletion, notifications, external links, that there is no tracking, and that RevenueCat and Apple process subscription purchases (what RevenueCat receives, as listed in section 3).
- **Age rating:** answer the questionnaire's tobacco/drug references question accurately; expect a higher rating than 4+. Consider whether the product targets adults only (the legal smoking age in Japan is 20).
- **Health and medical (guideline 1.4.1 / 5.1.3):** Puphii does not diagnose, measure or advise. Keep store screenshots and descriptions consistent with that; avoid "detox", "lung health" or "recovery" claims.
- **Review notes:** state that the app has no account, that its only network use is RevenueCat for subscriptions, and that reminders are optional local notifications.
- **Monetisation:** Puphii Pro is an annual subscription (`puphii_annual_2999`, a 7-day free trial planned in App Store Connect) and a monthly subscription (`puphii_monthly_499`) through RevenueCat, entitlement `puphii_pro`. The paywall (`src/screens/PaywallScreen.tsx`) opens only from the You screen and is never shown on launch. Subscription gating is off, so nothing is restricted. Prices, the trial and its eligibility come from StoreKit through RevenueCat; nothing is hard-coded. The paywall shows the price per period, trial length and post-trial price (only when RevenueCat confirms eligibility), auto-renewal and cancellation terms, Restore Purchases, and Terms of Use and Privacy Policy links. **Open before release:**
  - The Terms of Use and Privacy Policy URLs (`LEGAL_URLS` in `src/subscription/config.ts`) and the Puphii Pro benefits (`PRO_BENEFITS`) are unset. Release builds hide the Puphii Pro entry until all three are supplied; development builds show it with a "Before release" list. No placeholder links are used.
  - With gating off, Pro currently unlocks nothing. Guideline 3.1.1/3.1.2 expects a subscription to provide ongoing value; **owner decision** on what Pro includes before the entry is enabled for release.
  - The App Store products show "Missing Metadata" in App Store Connect; they can't be bought in sandbox or review until that is completed.
  - No Apple sandbox purchase has been completed yet. **Verify** purchase, trial display, cancellation and restore with a sandbox Apple Account on a development build.
  - Japan's Act on Specified Commercial Transactions display requirements and consumer law in each market still need an adviser's review of the final paywall.

## 9. Japan and future markets

Engineering facts the owner's adviser will need:

- Puff logs and other app data are never transmitted. Subscription purchases are processed by Apple and RevenueCat, and the developer can see that purchase data (under an anonymous ID, plus the device details listed in section 3) in the RevenueCat dashboard. Have an adviser confirm how Japan's Act on the Protection of Personal Information (APPI) applies; the treatment of "special care-required" information is relevant if data handling ever changes.
- Avoid wording that suggests diagnosis, treatment or prevention of disease, which could bring the app within Japan's Pharmaceutical and Medical Device Act (software as a medical device). Marketing claims are also subject to the Act against Unjustifiable Premiums and Misleading Representations.
- Nothing in the code restricts distribution to Japan. Before releasing in another market, re-check local privacy law (for example GDPR in the EU/UK), health-claim rules, tobacco-related advertising rules, age requirements and language.

## 10. Verification performed

- `npx tsc --noEmit`: passes.
- `npm test`: 17 passed, 0 failed (includes two new data-deletion tests).
- `npx expo prebuild --no-install --clean` in a scratch copy: generated Info.plist has no microphone string or background modes; entitlements are empty; the privacy manifest contains the declared values; the Android manifest has `allowBackup="false"` and the blocked permissions marked `tools:node="remove"`.
- Web, end to end: corrupted saved logs and settings were set aside on load; "Clear puff history" removed the log copy and kept settings; "Reset everything" removed both copies and dismissed the warning.

Not verified: a compiled iOS or Android release build, TestFlight processing, real-device reminders, and the merged privacy manifest after `pod install`.

RevenueCat integration (subscription phase 2A): an iOS Simulator **Debug** development build was prebuilt and compiled in a scratch copy (`pod install`, `xcodebuild`: succeeded). It kept `com.puphii.app`, bundled RevenueCat's privacy manifest (Purchase History, not linked, no tracking), ran on the simulator, and reported "not configured" without starting the SDK. Not verified: Android builds (no Android toolchain on the build machine), EAS cloud builds, release builds, real devices and sandbox purchases.
