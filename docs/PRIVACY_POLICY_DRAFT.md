# Puphii app Privacy Policy: draft section (legacy excerpt)

**Status: draft, not published.** Prefer the full app draft in `docs/APP_PRIVACY_POLICY.md` (and Terms in `docs/APP_TERMS_OF_USE.md`). The website polls notice must not be linked from the paywall. After owner approval and hosting at a stable `https://` URL, set `LEGAL_URLS.privacyPolicy` in `src/subscription/config.ts`.

The text below was checked against the code as of RevenueCat iOS SDK 5.94.0 (`react-native-purchases` 10.12.2): `src/subscription/revenueCatSdk.ts`, `src/subscription/revenueCat.ts` and the SDK sources under `ios/Pods/RevenueCat/Sources`. Re-check it whenever the SDK, its configuration or the subscription features change. Android has not been reviewed.

---

## Subscriptions (Puphii Pro)

Puphii Pro subscriptions are sold and charged by Apple through your Apple Account. Puphii never sees your card or payment details.

Puphii uses **RevenueCat** (RevenueCat, Inc.) to check whether you have Puphii Pro, show subscription prices and free-trial eligibility, and restore purchases. Puphii connects to RevenueCat each time you open the app or switch back to it, and when you open Puphii Pro or buy or restore a subscription. This happens whether or not you subscribe.

**What RevenueCat receives**

- **A RevenueCat customer ID.** It is random, created on your device, and not linked to a name, email address or account. It stays the same until you delete the app.
- **Your device's identifier for vendor (IDFV).** Apple assigns this ID to all apps from the same developer on your device. It resets when you delete all of that developer's apps.
- **Device and app details:** device model, iOS version, Puphii version, preferred languages and your App Store country.
- **Purchase information from Apple:** which subscription you bought, transaction IDs, purchase, renewal and expiry dates, trial status and the App Store receipt.
- **Tracking permission status.** This is your device's App Tracking Transparency status. Puphii never asks for tracking permission.
- **Your IP address**, as with any internet connection.

These identifiers do not include your name or contact details. They are persistent, though, so the information is **pseudonymous, not anonymous**: the developer can see a customer's purchase history under these IDs in RevenueCat.

**What RevenueCat does not receive**

- Your puff logs, savings details, settings and game scores stay on your device.
- Puphii does not collect your advertising identifier (IDFA). It does not ask for tracking permission and does not share data with advertising or attribution services.
- Puphii does not use RevenueCat's paywall, analytics, advertising or attribution features.

**Why:** only to provide the subscription: show what can be bought, confirm what you bought, and give you access. The information is not used for advertising or to track you across other companies' apps or websites.

RevenueCat processes this information as Puphii's service provider. See [RevenueCat's privacy policy](https://www.revenuecat.com/privacy).

**Your choices.** You can manage or cancel your subscription in your Apple Account settings. Deleting Puphii removes the customer ID and the data stored on your device. `[Owner to complete: how to request deletion of subscription records held by RevenueCat, how long they are kept, the contact address, and the developer's legal name and country.]`

---

## Owner checklist before publishing

1. Write the rest of the app policy: what stays on the device, notifications, contact details, children, changes to the policy and Japan's Act on the Protection of Personal Information (see `docs/COMPLIANCE_AUDIT.md`).
2. Fill in the bracketed items above.
3. Host it at a stable `https://` URL that is separate from the polls notice, then set `LEGAL_URLS.privacyPolicy`. Use the same URL in App Store Connect.
4. Make the App Privacy label match. Purchases → Purchase History is declared. **Verify** whether the IDFV that RevenueCat sends needs Identifiers → Device ID (see `docs/COMPLIANCE_AUDIT.md`, section 3).
