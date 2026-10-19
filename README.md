# Puphii MVP

A React Native + Expo (TypeScript) puff counter with the Puphii mascot, built on the approved ocean-blue and coral-pink design system.

This is an MVP prototype, not a medical product. The counter records what the user chooses to log; mascot expressions are playful feedback and do not represent an estimate of physical damage.

## Features

Bottom navigation: **Home**, **Insights** (Overview, Savings, History and Learn) and **You** (settings). The Bubble Break mini-game opens from a card on Home.

- **Home** — wordmark, settings shortcut, and an ocean reef scene (`assets/ocean/ocean-reef.jpg`) with today's count on an opaque plate and happy Puphii swimming beside it, turning now and then to face you, while a few small fish and bubbles drift past. Below it: the coral "+ Puff" button with Undo, a "+ Skip" button showing today's skips with its own Undo, and a compact chart of the current Sunday–Saturday week. Each tap records exactly one timestamped puff; rapid taps are never dropped, and reactions restart instead of queueing. The scene's motion stops on other tabs, in the background and with the system "reduce motion" setting (Puphii then rests facing you), and a Pause / Resume control under the scene stops it for the session.
- **Insights → Overview** — Week / Month / Year on the local calendar, with previous/next navigation. Shows logged puffs, the average per calendar day, days with logs, a neutral comparison with the previous equivalent period (the same number of days while a period is in progress), a tappable chart, and a morning / afternoon / evening / night breakdown once a period has at least five logs. Figures are logged counts only, not a measure of nicotine or health.
- **Insights → Savings** — an estimate of what you spend on cigarettes, vape pods, disposable vapes or another product, from what you buy and either how many you use per day/week or how long one purchase lasts. Shows daily, weekly, monthly (× 30.4375) and yearly (× 365.25) amounts with the formula used, 25 / 50 / 75% or a custom reduction scenario, and an optional savings goal with an estimated time to reach it. Amounts are projections, never money already saved, and are not derived from puff logs; this week's log count is shown separately for context only. Currency defaults to the device region and can be changed (amounts are relabelled, not converted).
- **Bubble Break** — an optional 30-second pause: tap bubbles as they float up for +1 each; bubbles that drift away cost nothing. Bubbles rise steadily with a gentle sway, each at a slightly different speed and size, and the round gets gently quicker and busier at 5, 10 and 20 seconds (1.2×, 1.4× and 1.6× the opening speed). It's meant as a calm distraction, not a test. All tuning lives in `DEFAULT_TUNING` in `src/game/bubbleBreak.ts`; `npm run simulate` compares configurations with simulated players. Taps count where the bubble is drawn (the circle plus a small finger allowance), and the round always lasts 30 real seconds, however slowly frames arrive. The round pauses when the app goes to the background, and the close button or any tab leaves it. Only the number of completed rounds and the best score are saved, on this device. No sound, haptics, streaks or rewards, and it never touches puff logs or calculator data.
- **Reaction modes** — Minimal, Expressive and Dramatic (manga-style effects), each lasting about a second, after which Puphii returns to happy idle. Expressions are character reactions, not a measure of health. Respects the system "reduce motion" setting.
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

- `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` / `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` — the **public** SDK keys (`appl_…`, `goog_…`). Copy `.env.example` to `.env.local` (git-ignored) and restart `npx expo start`: a development build loads its JavaScript, keys included, from your local server. Builds that embed their JavaScript (the `preview` and `production` profiles) read them from the EAS environment of the same name, because `.env.local` is not uploaded (see *EAS environment variables* below). Secret keys (`sk_…`) are refused and must never be added. Test Store keys (`test_…`) are refused here; they have their own variable (see below).
- `REVENUECAT_ENTITLEMENT_ID` in `src/subscription/config.ts` — `puphii_pro`, shared by every store including the Test Store.
- Each plan's `productIds` in `src/subscription/config.ts` — the App Store products `puphii_annual_2999` (1 year, 7-day free trial), `puphii_monthly_499` (1 month) and `puphii_weekly_199` (1 week), created in App Store Connect. Google Play IDs stay `null` until those products exist; on Android they take the form `subscriptionId:basePlanId`. Test Store products are listed separately in `TEST_STORE_PRODUCT_IDS` (`yearly_2999`, `monthly_499`, `weekly_199`) and are only used while the Test Store key is in use, which only development builds allow. Tests check the two sets never overlap or swap plans.
- Each plan's `packageId` (`$rc_annual`, `$rc_monthly`, `$rc_weekly`) is the same for every store and offering.

Build and install (requires an Expo account; `eas build` links the project on first run, adding the EAS project ID to `app.json`):

```bash
npx eas-cli build --profile development --platform ios              # device build; register devices with `npx eas-cli device:create`
npx eas-cli build --profile development-simulator --platform ios    # iOS Simulator build
npx eas-cli build --profile development --platform android          # installable APK
npx expo start --dev-client                                         # then open the project from the installed build
```

`eas.json` has the two development profiles above plus `preview` (internal distribution) and `production`; the bundle identifier and Android package stay `com.puphii.app`. Native `ios/` and `android/` folders are not committed: they are generated during the build.

### EAS environment variables

Each profile loads the EAS environment of its name (`development`, `preview`, `production`). `preview` and `production` builds embed their JavaScript, so they need the public iOS SDK key in their environment; `eas.json` itself holds no keys. Create it once per environment; the CLI prompts for the value:

```bash
npx eas-cli env:create --environment preview --name EXPO_PUBLIC_REVENUECAT_IOS_API_KEY --visibility sensitive
npx eas-cli env:create --environment production --name EXPO_PUBLIC_REVENUECAT_IOS_API_KEY --visibility sensitive
```

Only the public `appl_…` key goes here. Never add the Test Store key to `preview` or `production` (release builds ignore it anyway), and never add a RevenueCat secret key (`sk_…`) or an App Store Connect private key (`.p8`) to any app variable: `EXPO_PUBLIC_` values are compiled into the app. Apple key and certificate files (`*.p8`, `*.p12`, `*.mobileprovision`, `*.cer`) are git-ignored.

### RevenueCat Test Store (development builds only)

The Test Store simulates purchases without App Store Connect or Google Play: RevenueCat shows its own purchase sheet with buttons for a successful purchase, a failed purchase or cancelling. Nothing is charged. Results are real RevenueCat data (marked sandbox), so subscription status comes back through the normal entitlement service.

Safeguards: the Test Store key is read only when `__DEV__` is true, so release bundles don't contain it (checked by exporting production bundles); the store key variables refuse `test_…` keys; and RevenueCat's native SDK itself crashes on purpose if a release build is configured with a Test Store key. The test screen is also left out of release bundles.

The RevenueCat project (Puphii) is set up with these identifiers, which the app's configuration matches:

1. **Test Store and key.** *Apps and providers → Test configuration*. Its API key (`test_…`, also listed under *Project settings → API keys*) goes in `.env.local` via `npm run set-test-store-key`, which reads it without echoing it, refuses secret keys and keeps other variables.
2. **Entitlement** `puphii_pro`. Permanent; the real stores will use it too.
3. **Test Store products** `yearly_2999` (1 year, $29.99, 7-day free trial), `monthly_499` (1 month, $4.99, no trial) and `weekly_199` (1 week, $1.99, no trial). Price and duration can't be edited after saving; create a new product instead. The first two replace the original `yearly` and `monthly`.
4. **All three products attached** to `puphii_pro`.
5. **Offering** `default_v2`, with `$rc_annual` → `yearly_2999`, `$rc_monthly` → `monthly_499` and `$rc_weekly` → `weekly_199`. It is now the current offering; the Test Store screen still loads it by identifier (set in `src/dev/testStoreConfig.ts`), so it doesn't depend on which offering is current. The original `default` offering is unchanged.
6. **Sandbox access.** *Sandbox Testing Access* must let test purchases grant entitlements to anonymous users.

The Test Store screen lists only `default_v2`'s packages, and its **Setup check** compares them, as the SDK reports them, with this setup: all three packages, their product IDs, billing periods, prices and currency, a free 7-day trial on the annual product and no introductory offer on the monthly or weekly ones. If RevenueCat doesn't return `default_v2`, the screen says so and offers nothing to buy; it never falls back to the current offering. Whether a customer is still eligible for the trial is reported separately, in the subscription status. With the Test Store key, RevenueCat reports every product with a trial as eligible, even after the customer used it, so trial ineligibility can only be tested with sandbox store purchases.

Then run it:

```bash
npm run set-test-store-key     # paste the test_… key when prompted (input hidden)
npx eas-cli build --profile development-simulator --platform ios   # or --profile development for a device / Android
npx expo start --dev-client --clear
```

Open the app in the development build, open the developer menu (shake the device, press `m` in the terminal, or `⌃⌘Z` in the iOS Simulator) and choose **RevenueCat Test Store**. The screen lists the products and prices RevenueCat returns, buys a package (try success, failure and cancel), restores, refreshes, and shows both the app's subscription status and the raw customer info. Buying is disabled unless the Test Store key or, on iOS, the App Store key is in use (see below). Test subscriptions renew every 5 minutes (monthly) or every hour (annual), up to 5 times, then expire. Nothing is saved on the device, and no puff logs, settings or other app data are sent to RevenueCat. Expo Go can't make these purchases; use a development build.

### App Store sandbox purchases (development builds only)

With the public iOS key (`appl_…`) and no Test Store key, the same development screen buys the real App Store products through Apple's sandbox. Development builds are development- or ad hoc-signed, so StoreKit only ever charges a sandbox Apple Account, and nothing is billed. The screen is titled **RevenueCat · App Store sandbox**, loads `default_v2` by identifier (`src/dev/appStoreConfig.ts`) and checks its App Store products separately from the Test Store ones: product IDs, billing periods, a free 7-day trial on the annual product and no introductory offer on the monthly or weekly ones. Prices are shown but not judged, because the sandbox shows them in the tester's storefront currency. If RevenueCat ever records a purchase from this screen as non-sandbox, the screen logs a warning. Release builds don't contain this screen, and gating stays off. The only other place purchases start is the Puphii Pro paywall (below).

| Plan | App Store product | Test Store product | Package | Entitlement |
|---|---|---|---|---|
| Annual, 7-day free trial | `puphii_annual_2999` | `yearly_2999` | `$rc_annual` | `puphii_pro` |
| Monthly | `puphii_monthly_499` | `monthly_499` | `$rc_monthly` | `puphii_pro` |
| Weekly | `puphii_weekly_199` | `weekly_199` | `$rc_weekly` | `puphii_pro` |

Before it works, App Store Connect needs an active Paid Apps Agreement, all three subscriptions in one subscription group with their metadata complete, the free 1-week introductory offer on the annual product (and none on the monthly or weekly products), and a sandbox tester (*Users and Access → Sandbox*). RevenueCat needs an App Store app for `com.puphii.app` with an In-App Purchase key (`.p8`, uploaded to RevenueCat only), all three App Store products attached to `puphii_pro`, and `default_v2`'s packages holding them alongside the Test Store products. If `default_v2` comes back without App Store products, the screen says so and offers nothing to buy.

To test:

1. In `.env.local`, set `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` to the iOS public key (*Project settings → API keys*) and empty `EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY`: in development builds the Test Store key takes precedence whenever it is set. Don't paste keys into chats, commits or terminal history.
2. Install a development build on a physical iPhone (`npx eas-cli build --profile development --platform ios`, after registering it with `npx eas-cli device:create`), then run `npx expo start --dev-client --clear`. Sandbox purchases in the iOS Simulator have not been tested for this project.
3. Sign in to the sandbox tester on the device when Apple's purchase sheet asks, or beforehand in the device's sandbox account setting (its location in Settings depends on the iOS version). Never use a personal Apple Account.
4. Open the screen from **DEV ONLY → Open RevenueCat Test Store** on the You tab (or the developer menu), check that **Setup check** passes, then buy, cancel, restore and refresh. Apple's sheet should be marked as sandbox.
5. Afterwards, restore the Test Store key in `.env.local` and restart Metro to go back to simulated purchases.

Unlike the Test Store, the sandbox reports real trial eligibility: after a tester uses the free trial, the annual product reports it as ineligible until that tester's purchase history is cleared in App Store Connect. Sandbox renewals run on an accelerated schedule set per tester in App Store Connect.

### Puphii Pro paywall

**You → App Settings → Puphii Pro** opens the customer-facing paywall (`src/screens/PaywallScreen.tsx`, logic in `src/subscription/paywall.ts`). It is never shown on launch and, with gating off, locks nothing.

- **Products:** it checks RevenueCat's current offering and `default_v2` (`PAYWALL_OFFERING_ID`) and uses whichever holds more of this store's configured products in its `$rc_annual`, `$rc_monthly` and `$rc_weekly` packages (the current offering on a tie). A package is only offered when its product ID and billing period match `config.ts`, so App Store and Test Store products are never mixed. The weekly package is also dropped if the store reports any introductory offer on it (`NO_INTRO_OFFER_PLANS`), because the paywall never describes one for weekly and its wording would then misstate the charge. If a package is missing or fails these checks, the other plans are still shown: without a usable weekly package, the paywall offers Annual and Monthly. With the Test Store key, a development build's paywall shows the Test Store products.
- **Order and wording:** plans appear as Annual, Monthly, Weekly, with Annual selected by default. Each card shows the store's price per billing period once, then a line saying it renews until cancelled (for example, "$1.99 / week" and "Renews every week until you cancel."). The selected plan's terms, directly under the purchase button, state the price once more, with any eligible trial length, the charge after it, automatic renewal and how to cancel. Only the annual card shows a per-month equivalent; the SDK's per-month figures for shorter periods are approximations, so none is shown for weekly.
- **Accessibility:** each card is announced as one radio button, with the plan, any claimed trial, the price per period (and annual per-month equivalent) and renewal, each said once, for example "Weekly plan. $1.99 per week. Renews every week until you cancel." Text on the selected (peach) card uses `textPrimaryStrong`/`textMutedStrong`, and the disclosure and legal links use them too, so all reach WCAG AA 4.5:1 against peach and every color of the reef backdrop. The selected radio has a `coralInk` ring (3:1 or more against peach) and a check mark (checked in `tests/paywall.test.ts`). Text wraps and the screen scrolls; nothing is truncated.
- **Prices and trial:** every price is StoreKit's localized string as reported by RevenueCat (`priceString`, and `pricePerMonthString` for annual). A free trial is only mentioned when the product has a free introductory offer **and** `checkTrialOrIntroductoryPriceEligibility` reports the customer eligible; its length comes from the offer. When eligibility can't be checked, no trial is claimed. As configured, only the annual product has one; the monthly product is set up without one (the development screen's Setup check reports it if one appears), and the paywall describes whatever the store reports for it. Weekly never claims a trial.
- **Access:** only an active (or grace-period) `puphii_pro` entitlement counts as subscribed. A purchase is reported as successful only when the returned customer info has it; the entitlement service is then refreshed. Cancellation, pending approval, network and store errors grant nothing. Purchase and restore can't run twice at once.
- **Release configuration:** the Terms of Use and Privacy Policy URLs (`LEGAL_URLS`) and the list of Pro benefits (`PRO_BENEFITS`) in `src/subscription/config.ts` are unset. Release builds hide the Puphii Pro row until all three are set; development builds always show it, and the developer tools (RevenueCat Test Store screen) list what is missing under **Before release · Puphii Pro**. Use `https://` links only. How RevenueCat handles data is described in the app Privacy Policy draft (`docs/PRIVACY_POLICY_DRAFT.md`), not on the paywall.

To try it in a development build, open the You tab and tap **Puphii Pro**. With the Test Store key, purchases are simulated; with the iOS key, they go through Apple's sandbox as described above.

## Checks

```bash
npm run typecheck       # tsc --noEmit
npm test                # unit tests for day keys, DST, series, undo, sanitising, the write queue, insights, savings, Bubble Break, storage migrations and subscription status
```

## Project structure

- `App.tsx` — font loading, store provider, tab shell.
- `src/theme/` — colour, spacing, radius, shadow and typography tokens.
- `src/data/` — puff log types, pure date/count logic, AsyncStorage persistence, serialized write queue and the `PuphiiStore` context. `persistence.ts` and `migrations.ts` version the stored data: add a migration instead of renaming a key, and keep fields you don't recognise.
- `src/subscription/` — subscription entitlement types, access rules and plan configuration (gating is off). `revenueCat.ts` turns RevenueCat customer info into an entitlement and keeps it current (foreground refresh, update listener, a fresh check when the entitlement's expiry passes while the app is open, offline retries) and reports what a restore found; `revenueCatSdk.ts` is the only file that touches the native SDK; `EntitlementProvider` makes the status available to the app; `paywall.ts` picks and describes the Puphii Pro plans and runs purchases and restores for `src/screens/PaywallScreen.tsx`. The mock is for tests only.
- `src/dev/` — development-only tools, loaded by `App.tsx` behind `__DEV__` and absent from release bundles: the RevenueCat purchase screen (`TestStoreHarness.tsx`) and its logic (`testStoreHarness.ts`), with what each store's products should look like in `testStoreConfig.ts` (Test Store) and `appStoreConfig.ts` (App Store sandbox).
- `scripts/set-test-store-key.mjs` — saves the RevenueCat Test Store public key to the git-ignored `.env.local` without echoing it.
- `src/mascot/` — face registry, reaction-mode mapping, the animated `Mascot` component, and the reef scene's swim choreography and layout (`reefMotion.ts`).
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
