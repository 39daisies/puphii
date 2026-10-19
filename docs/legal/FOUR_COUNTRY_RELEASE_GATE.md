# Puphii 1.0 — Four-Country Release Gate

Status: In progress; repository observations are not physical-device or dashboard verification.

## Locked distribution
- United States, Australia, New Zealand, United Kingdom only.
- Exclude Canada, Japan, EU/EEA and other countries in App Store Connect.
- Verify app AND subscription product territory availability separately.

## Legal publishing
- Reuse Quope operator structure, not Quope-specific data handling.
- Operator: Naoko Hamasaki, trading as 39 Daisies, Oita Prefecture, Japan. Support: puphiicount@gmail.com.
- Drafts: docs/legal/PUPHII_PRIVACY_PUBLICATION_DRAFT.md and docs/legal/PUPHII_TERMS_PUBLICATION_DRAFT.md.
- Resolve UK GDPR representative applicability, transfers, rights, consumer laws, contact disclosures, age rating, Apple EULA selection, and App Privacy labels.
- Do not copy Quope iCloud, Supabase, Render, or legacy accounts without code evidence.
- Owner approves, publishes and verifies Puphii-specific HTTPS legal pages before LEGAL_URLS are set.

## Voice Pep Rally
- src/pepRally/media.ts currently defines interface, not verified native adapter.
- src/pepRally/access.ts still contains obsolete free/pro limits despite subscription-only launch.
- Implement and physically test recording, playback, rename, delete, 60-second cap, 50-recording cap, permission denial, interruptions, local-only media, backup exclusion read-back and reset cleanup.
- Never weaken file identity or backup exclusion checks.

## Subscription checks
- Annual US$29.99 with 7-day trial; monthly US$4.99 with 3-day trial; weekly US$1.99 no trial; actual localized store prices prevail.
- RevenueCat entitlement puphii_pro; offering default_v2.
- Verify App Store Connect and RevenueCat products, trial eligibility, sandbox purchase, restore, expiration and offline access.
- src/subscription/config.ts LEGAL_URLS remain null: purchases must remain blocked until legal URLs are live.

## Release gates
- No merge, build, submission, website publication, or external dashboard changes without owner approval.
- Run typecheck, complete automated tests, and native iPhone tests; report any unverified areas.
- Confirm exact country selections and subscription availability in App Store Connect rather than inferring them from code.

## Reviewed source
Repository main branch: src/pepRally/media.ts, src/pepRally/access.ts, src/subscription/config.ts, docs/APP_PRIVACY_POLICY.md, docs/APP_TERMS_OF_USE.md (19 October 2026).
