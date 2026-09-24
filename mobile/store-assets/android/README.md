# Mirobe on Google Play: what is ready, and what to do once the account is approved

Package: `com.orbexastudio.mirobe` · version 1.0.0 (versionCode 1) · PERSONAL project: use only the
personal Google account that owns the Play Console developer account. Never an Oklidis account.

Legend: **[Eren]** has to be done by hand in a console. **[Claude]** can be done by Claude through an API
once the credential named in the step exists and you say "go" (nothing is uploaded without that).

## What is already in this folder

| File | What |
|---|---|
| `mirobe-1.0.0-1.aab` | Release bundle, signed with the upload key (see below) |
| `icon-512.png` | Play store icon, 512×512, 32-bit, with the "mirobe" wordmark |
| `feature-graphic-tr.png`, `feature-graphic-en.png` | Feature graphic 1024×500 |
| `screenshots/{tr,en}/0N.png` | Phone screenshots 1080×2160 (2:1) |
| `listing.md` | Name, short and full description (TR + EN), Data safety answers, content rating guidance |
| `tools/` | Script that re-renders the images |
| `emulator/` | Screenshots of the Android smoke test (not for the store) |

## Upload key (Play App Signing)

- Keystore: `~/.personal-dev/android/mirobe-upload.jks` (PKCS12, RSA 4096, alias `mirobe-upload`,
  valid until 2054). Passwords: `~/.personal-dev/secrets.env` (`MIROBE_UPLOAD_*`). Gradle reads them from
  `~/.gradle/gradle.properties`; nothing is in the repo.
- Upload certificate fingerprints:
  - SHA-1 `C7:46:17:C8:AF:6D:02:5B:51:49:E8:4D:38:D0:FE:62:41:98:FE:C6`
  - SHA-256 `6C:C6:F9:96:0D:17:98:38:33:7A:9F:E3:DB:BB:D2:AB:B5:51:EB:09:E1:6D:D7:13:F2:34:56:C3:A6:45:D8:61`
- With Play App Signing, Google re-signs installs with its own **app signing key**. After the first
  upload, copy that key's SHA-1/SHA-256 from Play Console → Test and release → App integrity, and add
  **both** (upload and app signing) to the Firebase Android app.
- Back up the `.jks` and the passwords somewhere safe outside this Mac (password manager). If the upload
  key is lost, Play support can reset it, but it takes days.

## Rebuilding

```sh
cd mobile
npx expo prebuild -p android --clean     # android/ is generated; ios/ is never touched with -p android
cd android && ./gradlew bundleRelease     # → app/build/outputs/bundle/release/app-release.aab
./gradlew assembleRelease                 # → app/build/outputs/apk/release/app-release.apk (for a device/emulator)
```

The release signing is applied by `mobile/plugins/withReleaseSigning.js` on every prebuild. The JS bundle
takes `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` from `mobile/.env.local`.
**Bump `android.versionCode` in `app.json` for every upload** (Play refuses a versionCode it has seen).

---

## 1. Create the app  [Eren]

Play Console → Create app: name **Mirobe**, default language Turkish (tr-TR), App, Free, accept the
declarations. (Apps cannot be created through the API.)

Then fill in the "Set up your app" tasks with the answers in `listing.md`:
privacy policy `https://mirobe.orbexastudio.com.tr/api/legal/privacy`, account deletion URL
`https://mirobe.orbexastudio.com.tr/api/legal/delete-account` (**new page: deploy the server first**, together
with the platform-neutral privacy wording and the FCM sender), app access (demo account, see
`listing.md`), ads: no, content rating (IARC questionnaire), target audience, data safety, government
app: no, financial features: none, health: no, news: no.

- **[Claude]** once a Play service account exists (step 4): store listing texts and graphics
  (`edits.listings`, `edits.images`) and the Data safety form (`applications.dataSafety`, CSV) can be sent
  through the Play Developer API. Content rating, target audience and app access are console only.

## 2. Closed testing (required for new personal accounts)

Personal developer accounts created after Nov 2023 must run a **closed test with at least 12 testers who
stay opted in for 14 consecutive days** before "Apply for production" unlocks.

1. **[Eren]** Test and release → Testing → Internal testing → create a release, upload
   `mirobe-1.0.0-1.aab`, add yourself as tester. Install from the opt-in link and check purchase flows
   with a license tester (Settings → License testing: add the testers' Gmail addresses so purchases are free).
2. **[Eren]** Closed testing → create track (e.g. "Alpha") → same AAB (or promote from internal) → Testers:
   an email list or a Google Group with **at least 12 people** (keep a few spare; someone always drops out).
   Countries: Türkiye (+ others you want). Send the opt-in link; every tester must accept **and install**.
3. Keep them opted in for 14 days. Push an update or two in that time (bump versionCode) and ask for
   feedback: Google asks about the test in the production application.
4. **[Eren]** Dashboard → Apply for production, answer the questionnaire about the test.

- **[Claude]** once the service account exists: upload new AABs and move them between tracks
  (`edits.bundles.upload`, `edits.tracks.update`, `edits.commit`). Testers as a Google Group can be set
  with `edits.testers`; an email list is console only.

## 3. Subscriptions  [Eren or Claude]

Monetize → Products → Subscriptions (requires a merchant/payments profile, **[Eren]**, and at least one
uploaded AAB with the billing permission, which this one has through react-native-purchases).

Create **four subscriptions**, product IDs exactly as on iOS (the app and server match on them; Play
reports them as `productId:basePlanId`, which both already handle):

| Product ID | Base plan ID | Renewal | TRY | USD |
|---|---|---|---|---|
| `mirobe_plus_monthly` | `monthly` | Auto-renewing, 1 month | 499,99 TL | $9.99 |
| `mirobe_plus_annual` | `annual` | Auto-renewing, 1 year | 4.999,99 TL | $99.99 |
| `mirobe_pro_monthly` | `monthly` | Auto-renewing, 1 month | 1.199,99 TL | $19.99 |
| `mirobe_pro_annual` | `annual` | Auto-renewing, 1 year | 11.999,99 TL | $199.99 |

- Set the US price, let Play convert the others, then override Türkiye with the TL price above.
- Grace period 7 days and account hold (defaults) are fine; the server already handles BILLING_ISSUE.
- No free trial/intro offer (the iOS products have none).
- Activate each base plan.
- **[Claude]** with the service account: `monetization.subscriptions.create` + `basePlans.activate`
  (+ `convertRegionPrices`) can create all four in one go.

Then in **RevenueCat** (project "Orbexa Studio", Android app already exists with the `goog_…` key):
- **[Eren]** Upload the Play service-account JSON (step 4) under the Play Store app → Service credentials.
  It takes up to 36 h before RevenueCat validates it.
- **[Claude]** (RevenueCat v2 secret key is in `secrets.env`): import the four Play products, attach
  `mirobe_plus_*` to entitlement `mirobe_plus` and `mirobe_pro_*` to `mirobe_pro`, and add them to the
  current offering's monthly/annual packages next to the iOS ones.

## 4. Google Cloud service account (Play API + RevenueCat)  [Eren]

1. Google Cloud console (personal account) → use the Firebase project's Cloud project **`mirobe-448f6`**
   (one project for Play API, RevenueCat, RTDN and FCM).
2. Enable **Google Play Android Developer API** and **Google Play Developer Reporting API**
   (and **Cloud Pub/Sub API** for step 5).
3. IAM → Service accounts → create `revenuecat@…` → Keys → Add key → JSON. Save the JSON as
   `~/.personal-dev/android/play-service-account.json` (chmod 600). Never commit it.
4. Play Console → Users and permissions → Invite new users → the service account's email. App
   permissions for Mirobe: View app information, View financial data, Manage orders and subscriptions
   (RevenueCat), plus Release to testing tracks / Manage store presence if Claude should upload builds
   and listings.
5. Upload the JSON to RevenueCat (step 3).

## 5. Real-time developer notifications (RTDN)  [Eren]

In RevenueCat → Play Store app → Google developer notifications → "Connect to Google": pick the Cloud
project, RevenueCat creates the Pub/Sub topic and shows its name. Paste that topic into Play Console →
Monetize → Monetization setup → Real-time developer notifications, then "Send test notification";
RevenueCat shows it as received. (Alternatively create the topic yourself and grant
`google-play-developer-notifications@system.gserviceaccount.com` the Pub/Sub Publisher role.)

The server needs nothing new for this: RevenueCat webhooks already reach
`/api/billing/revenuecat-webhook` for both stores.

## 6. Firebase (Android push)

Done already (24 Sep 2026): Firebase project **`mirobe-448f6`**, Android app `com.orbexastudio.mirobe`
with the upload key SHA-1/SHA-256, `mobile/google-services.json` in place (git-ignored), FCM service
account at `~/.personal-dev/firebase/mirobe-fcm-service-account.json`. `mobile/app.config.js` sets
`android.googleServicesFile` only when the file exists, so a checkout without it still builds (push is
then simply off on Android). The current AAB is built with it.

Still to do:
1. **[Eren or Claude via Firebase Management API]** After the first Play upload, copy the **Play App
   Signing key** SHA-1 and SHA-256 (Play Console → Test and release → App integrity → App signing) and add
   them to the Firebase Android app. (Installs from Play are signed with that key, not the upload key.)
2. Done (24 Sep 2026): `FCM_SERVICE_ACCOUNT_BASE64` is set on the production server; its log shows `fcm: on`.
3. Payment notices go to the app's "Mirobe" channel (`channel_id: mirobe`); the daily reminder uses the
   app-created `daily` channel.
4. **Server deploy pending (needs Eren's go):** the "Report AI output" endpoint `POST /api/reports` and the
   report sentence in the privacy/delete-account pages are in the code but not yet on the server. The app
   thanks the user quietly until then; deploy before the first public Android release.

## 7. Before production

- Check the pre-launch report (Play runs the app on real devices) for crashes.
- Subscriptions active, RevenueCat shows Play products "Ready", a license-tester purchase unlocks Plus/Pro
  and the server reports the plan (`/api/billing/sync`).
- Data safety, content rating, target audience, app access: all green in the dashboard.
- Production release: start with a staged rollout (e.g. 20%).

## Summary: who does what

| Step | Eren | Claude (after the credential exists) |
|---|---|---|
| Create app, declarations, content rating, target audience, app access | ✔ | – |
| Store listing texts, images, Data safety CSV | or ✔ | ✔ Play Developer API |
| Upload AAB to internal/closed tracks | or ✔ | ✔ Play Developer API |
| 12 testers × 14 days, apply for production | ✔ | – |
| Payments profile | ✔ | – |
| Four subscriptions + prices | or ✔ | ✔ Play Developer API (monetization) |
| Cloud project, service account, invite to Play | ✔ | – |
| Service account JSON → RevenueCat, RTDN | ✔ | – |
| RevenueCat products → entitlements → offering | or ✔ | ✔ RevenueCat API v2 |
| Firebase project, Android app, google-services.json, FCM key | done | – |
| Play App Signing SHA-1/SHA-256 → Firebase (after first upload) | or ✔ | ✔ Firebase Management API |
| `FCM_SERVICE_ACCOUNT_BASE64` on the server | – | done |
| Deploy `POST /api/reports` (Report AI output) | go | ✔ on Eren's go |
