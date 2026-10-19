# Puphii App Store submission checklist (1.0.0)

Target window: **19–25 Oct 2026**. Distinguish **confirmed in code** from **dashboard / device**.

## Confirmed in this codebase

| Item | Value / note |
|------|----------------|
| Bundle id | `com.puphii.app` |
| Version | `1.0.0` (`app.json` / `package.json`) |
| iOS buildNumber | `1` |
| Icon | `assets/icon-app-store.png` (cigarette-free) |
| Encryption export | `usesNonExemptEncryption: false` |
| Privacy manifest | Purchase History + required-reason APIs in `app.json` |
| Entitlement id | `puphii_pro` |
| Offering | `default_v2` |
| Products | `puphii_annual_2999`, `puphii_monthly_499`, `puphii_weekly_199` |
| TARGET trials | Annual 7d · Monthly 3d · Weekly **none** (`NO_INTRO_OFFER_PLANS = ['weekly']`) |
| Default plan | Annual |
| Gating | Subscription-only (`SUBSCRIPTION_GATING_ENABLED`) |
| Legal URLs | **Still null** — purchases blocked until published |
| First-launch | Onboarding → plan preview → paywall → Home |
| Dev tools | Behind `__DEV__` only |

## App Store Connect (owner / dashboard)

- [ ] Create/verify IAP products and intro offers matching TARGET (7 / 3 / none)
- [ ] Attach products to the app version
- [ ] Privacy Policy URL (published app policy — not polls page)
- [ ] Terms / EULA URL or Apple Standard EULA
- [ ] App Privacy nutrition labels (Purchases → Purchase History; verify Device ID with counsel)
- [ ] Age rating / tobacco-related questions answered accurately
- [ ] Screenshots, description, keywords, support URL
- [ ] Review notes: habit awareness, no medical claims, sandbox test account
- [ ] Export compliance / encryption answers

## RevenueCat (owner / dashboard)

- [ ] iOS public SDK key in EAS / CI secrets (never commit)
- [ ] Entitlement `puphii_pro` attached to all three products
- [ ] Offering `default_v2` current or resolvable; packages `$rc_annual` / `$rc_monthly` / `$rc_weekly`
- [ ] Products map to App Store product ids above
- [ ] Sandbox purchase + restore verified on a physical iPhone

## Physical iPhone / TestFlight

- [ ] Fresh install onboarding → paywall → purchase/trial
- [ ] Trial-eligible vs ineligible UI (no false trial on weekly)
- [ ] Restore Purchases
- [ ] Offline / airplane entitlement behaviour
- [ ] Expiration → paywall; local history preserved
- [ ] Puff / Skip / Undo; plan persistence; Insights; Savings
- [ ] Clear history / Reset + Pep Rally media deletion
- [ ] Small phone layout + Dynamic Type / VoiceOver smoke test
- [ ] Reminder permission deny/allow
- [ ] Merged privacy manifest after `pod install` in release build

## Code wiring after publish

- [ ] Set `LEGAL_URLS.privacyPolicy` and `LEGAL_URLS.termsOfUse` to the live https URLs
- [ ] Optional `SUPPORT_URL`
- [ ] Bump `ios.buildNumber` for each upload

## Blockers that keep the build NOT READY

1. Legal URLs unset → purchase CTA blocked by design  
2. ASC intro offers not verified against TARGET  
3. No published app Privacy Policy / Terms  
4. Physical-device sandbox purchase not verified in this sprint  
