# Puphii MVP

A React Native + Expo (TypeScript) puff counter with the Puphii mascot, built on the approved ocean-blue and coral-pink design system.

This is an MVP prototype, not a medical product. The counter records what the user chooses to log; mascot expressions are playful feedback and do not represent an estimate of physical damage.

## Features

Bottom navigation: **Home**, **Insights** (Overview, Savings, History and Learn) and **You** (settings). The Bubble Break mini-game opens from a card on Home.

- **Home** — wordmark, settings shortcut, today's count as the main element with a small Puphii beside it, the coral "+ Log a puff" button, Undo, and a compact chart of the current Sunday–Saturday week. Each tap records exactly one timestamped puff; rapid taps are never dropped, and reactions restart instead of queueing.
- **Insights → Overview** — Week / Month / Year on the local calendar, with previous/next navigation. Shows logged puffs, the average per calendar day, days with logs, a neutral comparison with the previous equivalent period (the same number of days while a period is in progress), a tappable chart, and a morning / afternoon / evening / night breakdown once a period has at least five logs. Figures are logged counts only, not a measure of nicotine or health.
- **Insights → Savings** — an estimate of what you spend on cigarettes, vape pods, disposable vapes or another product, from what you buy and either how many you use per day/week or how long one purchase lasts. Shows daily, weekly, monthly (× 30.4375) and yearly (× 365.25) amounts with the formula used, 25 / 50 / 75% or a custom reduction scenario, and an optional savings goal with an estimated time to reach it. Amounts are projections, never money already saved, and are not derived from puff logs; this week's log count is shown separately for context only. Currency defaults to the device region and can be changed (amounts are relabelled, not converted).
- **Bubble Break** — an optional 30-second pause: tap bubbles as they float up for +1 each; bubbles that drift away cost nothing. Bubbles rise steadily with a gentle sway, each at a slightly different speed and size, and the round gets gently quicker and busier at 5, 10 and 20 seconds (1.2×, 1.4× and 1.6× the opening speed). It's meant as a calm distraction, not a test. All tuning lives in `DEFAULT_TUNING` in `src/game/bubbleBreak.ts`; `npm run simulate` compares configurations with simulated players. Taps count where the bubble is drawn (the circle plus a small finger allowance), and the round always lasts 30 real seconds, however slowly frames arrive. The round pauses when the app goes to the background, and the close button or any tab leaves it. Only the number of completed rounds and the best score are saved, on this device. No sound, haptics, streaks or rewards, and it never touches puff logs or calculator data.
- **Reaction modes** — Minimal, Expressive and Dramatic (manga-style effects), each lasting under a second. Puphii is still when idle. Respects the system "reduce motion" setting.
- **Insights → History** — week / month / all-time charts, daily and weekly totals, and timestamped entries grouped by day, with per-entry delete.
- **Insights → Learn** — short evidence-based topics linking to CDC, Smokefree.gov and NHS sources. No diagnosis.
- **You** — reaction mode, sound, haptics, optional daily reminder (off by default; notification permission is only requested when enabled), data management (clear history / reset everything) and About.
- Everything is stored locally with AsyncStorage, keyed to the device's local calendar day, and excluded from device backups. No account, backend, advertising or analytics.

## Run the app

Requires Node.js 22.13 or newer.

```bash
npm install
npm run start:go        # Expo Go: then press i (iOS), a (Android) or w (web)
npx expo start          # a development build (see below)
```

Because `expo-dev-client` is installed, plain `npx expo start` targets a development build. Use `npm run start:go` (or press `s` in the Expo CLI) to keep using Expo Go. In Expo Go and on the web there is no store connection, so subscription status reports "store unavailable"; the app is otherwise unaffected.

When running in Expo Go, Expo's floating developer-tools button can cover the app's settings shortcut in the top-right corner of Home. It is not part of the app and does not appear in development or production builds.

## Development builds and subscriptions

Subscriptions use RevenueCat (`react-native-purchases`), which needs native code, so it only works in a development or store build. Subscription gating is off (`SUBSCRIPTION_GATING_ENABLED = false`): every screen stays fully accessible whatever the status.

The SDK only starts when all of these are set; until then the status is "not configured" and no RevenueCat request is made:

- `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` / `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` — the **public** SDK keys (`appl_…`, `goog_…`). Copy `.env.example` to `.env.local` (git-ignored) and restart `npx expo start`: a development build loads its JavaScript, keys included, from your local server. Builds that embed their JavaScript (later preview and store builds) need the same variables in the matching EAS environment, because `.env.local` is not uploaded. Secret keys (`sk_…`) are refused and must never be added. Test Store keys (`test_…`) are refused here; they have their own variable (see below).
- `REVENUECAT_ENTITLEMENT_ID` in `src/subscription/config.ts` — `puphii_pro`, shared by every store including the Test Store.
- Each plan's `productIds` in `src/subscription/config.ts` — `null` until the App Store / Google Play products exist. On Android, they take the form `subscriptionId:basePlanId`. Test Store products are listed separately in `TEST_STORE_PRODUCT_IDS` (`yearly`, `monthly`) and are only used while the Test Store key is in use, which only development builds allow.
- The offering (`REVENUECAT_OFFERING_ID`, `default`) and each plan's `packageId` (`$rc_annual`, `$rc_monthly`) are the same for every store. The app reads RevenueCat's current offering; these values are only compared against it on the Test Store screen.

Build and install (requires an Expo account; `eas build` links the project on first run, adding the EAS project ID to `app.json`):

```bash
npx eas-cli build --profile development --platform ios              # device build; register devices with `npx eas-cli device:create`
npx eas-cli build --profile development-simulator --platform ios    # iOS Simulator build
npx eas-cli build --profile development --platform android          # installable APK
npx expo start --dev-client                                         # then open the project from the installed build
```

`eas.json` only adds development profiles; the bundle identifier and Android package stay `com.puphii.app`. Native `ios/` and `android/` folders are not committed: they are generated during the build.

### RevenueCat Test Store (development builds only)

The Test Store simulates purchases without App Store Connect or Google Play: RevenueCat shows its own purchase sheet with buttons for a successful purchase, a failed purchase or cancelling. Nothing is charged. Results are real RevenueCat data (marked sandbox), so subscription status comes back through the normal entitlement service.

Safeguards: the Test Store key is read only when `__DEV__` is true, so release bundles don't contain it (checked by exporting production bundles); the store key variables refuse `test_…` keys; and RevenueCat's native SDK itself crashes on purpose if a release build is configured with a Test Store key. The test screen is also left out of release bundles.

The RevenueCat project (Puphii) is set up with these identifiers, which the app's configuration matches:

1. **Test Store and key.** *Apps and providers → Test configuration*. Its API key (`test_…`, also listed under *Project settings → API keys*) goes in `.env.local` via `npm run set-test-store-key`, which reads it without echoing it, refuses secret keys and keeps other variables.
2. **Entitlement** `puphii_pro`. Permanent; the real stores will use it too.
3. **Test Store products** `yearly` (1 year, $29.99, 7-day free trial) and `monthly` (1 month, $4.99, no trial). Price and duration can't be edited after saving; create a new product instead.
4. **Both products attached** to `puphii_pro`.
5. **Offering** `default`, current, with `$rc_annual` → `yearly` and `$rc_monthly` → `monthly`.
6. **Sandbox access.** *Sandbox Testing Access* must let test purchases grant entitlements to anonymous users.

The Test Store screen's **Setup check** compares what RevenueCat returns with this: the current offering, both packages, their product IDs and billing periods, and that only the annual plan has a free trial. Prices and trial length are shown for comparison with the dashboard but not judged.

Then run it:

```bash
npm run set-test-store-key     # paste the test_… key when prompted (input hidden)
npx eas-cli build --profile development-simulator --platform ios   # or --profile development for a device / Android
npx expo start --dev-client --clear
```

Open the app in the development build, open the developer menu (shake the device, press `m` in the terminal, or `⌃⌘Z` in the iOS Simulator) and choose **RevenueCat Test Store**. The screen lists the products and prices RevenueCat returns, buys a package (try success, failure and cancel), restores, refreshes, and shows both the app's subscription status and the raw customer info. Buying is disabled unless the Test Store key is in use. Test subscriptions renew every 5 minutes (monthly) or every hour (annual), up to 5 times, then expire. Nothing is saved on the device, and no puff logs, settings or other app data are sent to RevenueCat. Expo Go can't make these purchases; use a development build.

## Checks

```bash
npm run typecheck       # tsc --noEmit
npm test                # unit tests for day keys, DST, series, undo, sanitising, the write queue, insights, savings, Bubble Break, storage migrations and subscription status
```

## Project structure

- `App.tsx` — font loading, store provider, tab shell.
- `src/theme/` — colour, spacing, radius, shadow and typography tokens.
- `src/data/` — puff log types, pure date/count logic, AsyncStorage persistence, serialized write queue and the `PuphiiStore` context. `persistence.ts` and `migrations.ts` version the stored data: add a migration instead of renaming a key, and keep fields you don't recognise.
- `src/subscription/` — subscription entitlement types, access rules and plan configuration (gating is off). `revenueCat.ts` turns RevenueCat customer info into an entitlement and keeps it current (foreground refresh, update listener, offline handling); `revenueCatSdk.ts` is the only file that touches the native SDK; `EntitlementProvider` makes the status available to the app. The mock is for tests only.
- `src/dev/` — development-only tools, loaded by `App.tsx` behind `__DEV__` and absent from release bundles: the RevenueCat Test Store screen (`TestStoreHarness.tsx`) and its logic (`testStoreHarness.ts`).
- `scripts/set-test-store-key.mjs` — saves the RevenueCat Test Store public key to the git-ignored `.env.local` without echoing it.
- `src/mascot/` — face registry, reaction-mode mapping and the animated `Mascot` component.
- `src/components/` — shared UI (buttons, cards, tab bar, dialogs, chart, settings rows, number/text fields, option sheet, icons, backgrounds).
- `src/data/insights.ts` — pure period, comparison and time-of-day calculations behind Insights.
- `src/data/savings.ts` — pure spending, scenario and goal calculations, number parsing, currency formatting and sanitising for the savings calculator.
- `src/game/` — pure Bubble Break round rules, the frame-loop controller and the saved round record.
- `src/screens/` — Home, Insights (Overview, Savings, History, Learn), Settings and Bubble Break.
- `src/services/` — sound, haptics and reminders.
- `src/content/learn.ts` — Learn copy and sources.
- `assets/puffy/` — transparency-checked mascot expressions.
- `assets/fonts/` — Fraunces Black Soft instance and its OFL licence.
- `tests/` — Node test-runner unit tests.
- `plugins/withoutPushEntitlement.js` — removes the unused APNs entitlement; reminders are local notifications only.
- `docs/COMPLIANCE_AUDIT.md` — privacy, permissions and pre-launch audit with open items.
- `preview.html` — an early no-build design prototype; it predates the current app and is not kept in sync.

## Design tokens

| Token | Hex | Use |
|---|---|---|
| Sky Blue | `#E8F6FF` | Main background |
| Ocean Blue | `#BFE6F7` | Surfaces and accents |
| Seafoam | `#A8DCCC` | Aquatic accent |
| Deep Ocean | `#176B91` | Primary text and icons |
| Coral Pink | `#FFB7A7` | Selected states, highlights, decoration |
| Peach | `#FFD6CC` | Soft selected backgrounds |
| Warm Cream | `#FFFDF6` | Cards and breathing room |

For legibility, white button text sits on a deeper coral (`#E06A57`), and coral-coloured text uses `#A8402F`.

Typography: **Fraunces Black** (a static instance of the Fraunces variable font at opsz 72, wght 900, SOFT 100) for the wordmark, headings and counts; **Inter** for interface copy and data. Both are bundled and loaded with `expo-font`.
