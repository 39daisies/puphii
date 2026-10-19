# Puphii app — Terms of Use (draft)

**Status: draft for owner review. Not published. Do not set `LEGAL_URLS.termsOfUse` until approved and hosted at a stable `https://` URL.**

Draft HTML also exists under the separate `puphii-pages` project and is marked “not in effect.” Do not link the app to unpublished drafts.

## Owner review required

- [ ] Operator legal name and contact
- [ ] Governing law and venue
- [ ] Standard Apple EULA vs custom terms decision (App Store Connect)
- [ ] Liability / disclaimer language approved by counsel
- [ ] Subscription cancellation / refund language consistent with Apple’s rules
- [ ] Health / wellness disclaimer (Puphii is not a medical device; logs are not health measurements)
- [ ] Language versions (English-only app today)

## 1. The app

Puphii is a personal habit-awareness app for logging puffs and skips, viewing on-device insights, optional savings estimates, a short Bubble Break activity, and an optional reduction plan. It is **not** a medical device and does not diagnose, treat, or cure any condition.

## 2. Subscriptions (Puphii Pro)

Full app access requires an active subscription or introductory trial managed through the App Store via RevenueCat. Plans, prices, and trial eligibility are shown from Apple’s store product information at purchase time. Subscriptions renew until cancelled in Apple Account settings. Restore Purchases is available in the app.

**OWNER: confirm final ASC product intros: Annual 7-day trial, Monthly 3-day trial, Weekly no trial.**

## 3. Your content

Logs, plans, and optional Pep Rally media you create stay on your device in this build. You are responsible for content you record (including any third-party voices) and for complying with applicable law.

## 4. Acceptable use

Do not misuse the app, attempt to interfere with store billing, or reverse engineer beyond rights granted by applicable law and Apple’s terms.

## 5. Disclaimers

**OWNER / counsel: warranty disclaimer and limitation of liability.**

## 6. Changes and contact

**OWNER: change process and contact details.**

---

### Publishing steps

1. Counsel / owner approval.
2. Host at a dedicated Terms URL.
3. Set `LEGAL_URLS.termsOfUse` in `src/subscription/config.ts`.
4. Use the same URL in App Store Connect (and Custom EULA field if applicable).
