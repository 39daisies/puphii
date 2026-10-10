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
npx expo start          # then press i (iOS), a (Android) or w (web)
```

When running in Expo Go, Expo's floating developer-tools button can cover the app's settings shortcut in the top-right corner of Home. It is not part of the app and does not appear in development or production builds.

## Checks

```bash
npm run typecheck       # tsc --noEmit
npm test                # unit tests for day keys, DST, series, undo, sanitising, the write queue, insights, savings and Bubble Break
```

## Project structure

- `App.tsx` — font loading, store provider, tab shell.
- `src/theme/` — colour, spacing, radius, shadow and typography tokens.
- `src/data/` — puff log types, pure date/count logic, AsyncStorage persistence, serialized write queue and the `PuphiiStore` context.
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
