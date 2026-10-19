# Puphii app — Privacy Policy (draft)

**Status: draft for owner review. Not published. Do not set `LEGAL_URLS.privacyPolicy` until this text is approved and hosted at a stable `https://` URL that is separate from any waitlist/polls notice.**

**Last reviewed against code in this repository (Expo / iOS focus). Android Play Billing not reviewed.**

## Owner review required

- [ ] Legal entity / operator name and contact email or postal address
- [ ] Country of establishment and governing law notice (if any)
- [ ] Retention periods for on-device data after deletion requests (technical: data is deleted from the device when the user clears history or resets; no Puphii cloud account exists)
- [ ] Whether Device ID (IDFV) disclosure is required in App Store Privacy labels for RevenueCat (verify with RevenueCat / counsel)
- [ ] Age / children’s privacy stance (app is not directed at children; confirm rating and copy)
- [ ] French / Québec availability of this policy if distributing in Canada

## 1. Who this policy covers

This policy describes the **Puphii mobile app** (bundle id `com.puphii.app`). It does **not** cover the waitlist website or poll pages.

## 2. What Puphii stores on your device

Puphii is designed so your habit data stays on your device. The app may store locally (AsyncStorage / app files), including:

- Puff and Skip log timestamps and related product metadata you enter
- Settings (for example reaction mode, reminder preferences)
- Savings calculator inputs you enter
- Bubble Break game stats (rounds completed, best score)
- Reduction plan settings and milestones
- Skip milestones
- App lifecycle markers (first launch time, onboarding completion)
- Optional Voice Pep Rally metadata and media files you create (local files only)

Puphii does **not** create a Puphii account or sync puff/skip history to a Puphii-operated backend in this build.

## 3. Subscriptions and RevenueCat

If you start a purchase or restore, Puphii uses **RevenueCat** (`react-native-purchases`) and Apple’s App Store to manage subscriptions.

As configured in this codebase, RevenueCat receives subscription-related information needed to unlock the app (for example App Store transaction / receipt data, a RevenueCat customer identifier that is not your puff history, and app / device / storefront metadata the SDK sends). Puphii does **not** send puff logs, skips, savings inputs, plan details, or Pep Rally media to RevenueCat.

See also [RevenueCat’s privacy policy](https://www.revenuecat.com/privacy).

**OWNER: confirm RevenueCat’s current data practices and any IDFV / identifier disclosures before publishing.**

## 4. Notifications

If you enable a daily reminder, the system notification permission may be requested. Reminder scheduling uses local notifications. Puphii does not use remote push entitlements in the current configuration.

## 5. Optional links to third-party sites

If you open Learn “Sources” links, your device browser loads those sites (for example public-health sites). Those sites have their own policies. Puphii does not attach your puff history to those URLs.

## 6. Permissions

Current Expo / iOS configuration does not request microphone, camera, photo library, location, contacts, or health permissions for core tracking. Pep Rally recording (if enabled later) may require microphone permission — **re-audit this policy before shipping any recording UI.**

## 7. Deletion

You can clear puff history or reset app data from Settings. Resetting removes user data listed in the app’s reset scope; lifecycle markers such as first-launch / onboarding completion may be retained so the app does not treat a reset install as a brand-new first launch incorrectly. Pep Rally media is deleted when Pep Rallies are reset.

Uninstalling the app removes local data from the device (subject to OS backup behaviour).

Subscription billing is managed by Apple; cancel in your Apple Account settings.

## 8. Children’s privacy

**OWNER: state whether the app is offered to children and any COPPA / local age rules.**

## 9. Changes

**OWNER: describe how material changes will be communicated once a contact channel exists.**

## 10. Contact

**OWNER: insert contact email / address.**

---

### Publishing steps (do not skip)

1. Owner approves text and fills every Owner review item.
2. Host at a dedicated app Privacy Policy URL (not the polls page).
3. Set `LEGAL_URLS.privacyPolicy` in `src/subscription/config.ts`.
4. Use the same URL in App Store Connect.
5. Align App Privacy nutrition labels with Section 3 and the privacy manifest in `app.json`.
