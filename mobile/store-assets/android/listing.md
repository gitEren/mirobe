# Mirobe · Google Play listing

Personal app (package `com.orbexastudio.mirobe`). Nothing here has been uploaded. Character counts are Unicode
characters, as Play Console counts them.

Texts are adapted from the App Store Connect listing of version 1.0.0 (read on 2026-09-24 with
`tools/asc.mjs`, GET only): name and subtitle from appInfoLocalizations (tr, en-US), description and promotional
text from appStoreVersionLocalizations (tr, en-US). Changes for Play: the Apple EULA line and "App Store account
settings" were removed; payment and renewal wording now points to Google Play; the plan paragraph lists each
plan's monthly allowances from `shared/src/plans.ts` (PLANS); bullets use "•"; Terms and Privacy links added.

The short description is based on the App Store promotional text.

## Türkçe (tr-TR)

**App name** (28/30)

```text
Mirobe: AI Kombin & Gardırop
```

**Short description** (76/80)

```text
Kıyafetlerini çek, Jev kombin önersin, giyinmeden önce kombini üzerinde gör.
```

**Full description** (2192/4000)

```text
Mirobe, dolabındaki kıyafetlerden daha fazla kombin çıkarmanı sağlar.

Bir parçanın fotoğrafını çek, türü, rengi ve tarzıyla birlikte dijital dolabına eklensin. Birkaç dakika ayırdığında tüm gardırobun telefonunda olur.

Ne giyeceğine karar veremediğin günlerde uygulamadaki stilistin Jev'e sor. Akşam yemeğe çıkacağını ya da sabah sunumun olduğunu söyle, sana kendi kıyafetlerinden bir kombin hazırlasın. İstersen yaz, istersen sesli anlat.

Giyinmeden önce nasıl duracağını görmek mi istiyorsun? Tam boy bir fotoğrafını ekle, Mirobe kombini senin üzerinde göstersin. Pro ile bu denemeyi kısa bir videoya da çevirebilirsin.

Neler yapabilirsin
• Kıyafetlerinin fotoğrafını çekerek dijital gardırobunu oluştur
• İş, davet, tatil ve hafta sonu için kombin önerileri al
• Kombinleri kendi fotoğrafının üzerinde sanal olarak dene
• Beğendiğin kombinleri kaydet, sonra kolayca bul
• Stil profilini ve dolabında eksik kalan temel parçaları gör
• Uygulamayı Türkçe ya da İngilizce kullan

Paketler
Mirobe'yi kullanmaya ücretsiz başlayabilirsin; yapay zekâ özellikleri için ücretsiz bir hesap yeterli. Ücretsiz pakette her ay 3 görsel (deneme ya da stüdyo görseli), Jev'e 30 istek (kombin seçimi ya da sohbet mesajı) ve 20 yapay zekâ etiketleme bulunur.
• Plus: her ay 100 görsel, Jev'e 300 istek ve 200 etiketleme
• Pro: her ay 200 görsel, 8 kısa video klip, Jev'e 750 istek ve 450 etiketleme
Plus ve Pro aylık ya da yıllık abonelik olarak sunulur. Ödeme, satın almayı onayladığında Google Play hesabından alınır. Abonelik, mevcut dönem bitmeden iptal edilmezse aynı süre ve fiyatla otomatik olarak yenilenir. Aboneliğini dilediğin zaman Google Play Store'da Profil > Ödemeler ve abonelikler > Abonelikler bölümünden yönetebilir ya da iptal edebilirsin; iptal, ödemesini yaptığın dönemin sonunda geçerli olur.

Gizlilik
Fotoğraflarını ve Jev'e yazdıklarını yapay zekâ sağlayıcılarına göndermeden önce Mirobe senden izin ister. Reklam yok, verilerin satılmaz. Hesabını ve içindeki her şeyi dilediğin zaman Profil ekranından silebilirsin.

Kullanım Koşulları: https://mirobe.orbexastudio.com.tr/api/legal/terms?lang=tr
Gizlilik Politikası: https://mirobe.orbexastudio.com.tr/api/legal/privacy?lang=tr
```

## English (en-US)

**App name** (28/30)

```text
Mirobe: AI Outfit & Wardrobe
```

**Short description** (75/80)

```text
Snap your clothes, get outfit ideas from Jev and see the look on you first.
```

**Full description** (2203/4000)

```text
Mirobe helps you get more out of the clothes you already own.

Take a photo of a piece and it goes straight into your digital closet, sorted by type, color and style. Spend a few minutes on it and your whole wardrobe is on your phone.

When you can't decide what to wear, ask Jev, the stylist inside the app. Tell it you have a dinner tonight or a presentation in the morning and it puts together an outfit from your own clothes. You can type or just talk to it.

Want to see how it looks before you get dressed? Add one full-length photo of yourself and Mirobe shows you wearing the outfit. With Pro you can also turn that try-on into a short video clip.

What you can do
• Build your digital wardrobe by photographing your clothes
• Get outfit ideas for work, dates, trips and weekends
• Try outfits on virtually using your own photo
• Save the looks you like and find them again later
• See your style profile and which basics your closet is missing
• Use the app in English or Turkish

Plans
Mirobe is free to start. The AI features need a free account. The free plan includes 3 images (try-ons or studio images), 30 requests to Jev (outfit picks or chat messages) and 20 AI taggings every month.
• Plus: 100 images, 300 requests to Jev and 200 taggings every month
• Pro: 200 images, 8 short video clips, 750 requests to Jev and 450 taggings every month
Plus and Pro are available as monthly or yearly subscriptions. Payment is charged to your Google Play account when you confirm the purchase. A subscription renews automatically for the same period and price unless you cancel it before the current period ends. You can manage or cancel it any time in the Google Play Store under Profile > Payments & subscriptions > Subscriptions; cancelling takes effect at the end of the period you have already paid for.

Privacy
Mirobe asks for your permission before it sends your photos or messages to Jev to its AI providers. No ads, and your data is never sold. You can delete your account and everything in it from the Profile screen whenever you want.

Terms of Use: https://mirobe.orbexastudio.com.tr/api/legal/terms?lang=en
Privacy Policy: https://mirobe.orbexastudio.com.tr/api/legal/privacy?lang=en
```

## Graphics

| File | Size | Notes |
|---|---|---|
| `icon-512.png` | 512×512, 32-bit RGBA, opaque | Same design as the iOS icon (mirror + sparkle, "mirobe" wordmark) on #2B2824 with a light top-to-bottom gradient. Full-bleed square: Play adds its own mask and shadow. |
| `feature-graphic-tr.png`, `feature-graphic-en.png` | 1024×500, 24-bit RGB | Mark + wordmark, kicker, tagline from App Store slide 01 ("Kombini giyinmeden *üzerinde gör*" / "See the outfit *on you* before you get dressed"), try-on screen on the right. |
| `screenshots/{tr,en}/01–06.png` | 1080×2160 (2:1), 24-bit RGB | Re-rendered from the App Store compose (same copy, fonts and colours, `screenshots/compose/slides.mjs`) at a 2:1 canvas. The iOS status bar (clock + Dynamic Island) is replaced with a neutral Android-style bar. |

Rebuild everything with `node mobile/store-assets/android/tools/render.mjs [icon] [feature] [shots]`.
It needs Google Chrome and the repo's `node_modules`, and it only writes into `mobile/store-assets/android/`.

## Store settings

- **App category:** Lifestyle (the Play category closest to the App Store's). Beauty is for cosmetics and
  hair, and Shopping is for apps that sell things, so neither fits.
- **Tags** (pick in Console): Fashion, Style, Outfits, Wardrobe / Closet organizer, if they're offered.
- **Contact email:** `support@orbexastudio.com.tr` (the address on the App Store support page,
  `server/src/routes/legal.ts`). Privacy requests go to `privacy@orbexastudio.com.tr`.
- **Website** (optional): the App Store listing has no marketing URL. Use the support page if you want one:
  `https://mirobe.orbexastudio.com.tr/api/legal/support?lang=tr`
- **Privacy policy URL:** `https://mirobe.orbexastudio.com.tr/api/legal/privacy` (the page picks TR or EN from
  the browser; `?lang=tr|en` forces a language).
- **Contains ads:** No. There is no ad SDK in `mobile/package.json`, and the privacy policy says there are no ads or
  analytics SDKs.
- **In-app purchases:** Yes. Subscriptions: `mirobe_plus_monthly`, `mirobe_plus_annual`, `mirobe_pro_monthly`,
  `mirobe_pro_annual`, managed through RevenueCat (`shared/src/plans.ts`, `REVENUECAT_PRODUCTS`).

| Product | TRY | USD | Monthly allowance (PLANS) |
|---|---|---|---|
| Free | – | – | 3 images, 0 videos, 30 Jev requests, 20 taggings |
| Plus monthly / yearly | 499,99 TL / 4.999,99 TL | $9.99 / $99.99 | 100 images, 0 videos, 300 Jev requests, 200 taggings |
| Pro monthly / yearly | 1.199,99 TL / 11.999,99 TL | $19.99 / $199.99 | 200 images, 8 five-second video clips, 750 Jev requests, 450 taggings |

"Images" means photo try-ons and AI studio packshots, and each counts as one. A Jev request is one outfit pick or
one chat message. Allowances reset every month, and yearly plans get the same monthly allowances. The live
mirror is switched off (`LIVE_MIRROR_ENABLED = false`), so it isn't mentioned in the listing.

## App access (for review)

Choose "All or some functionality is restricted". The AI features need a signed-in account.

- **Credentials:** the demo account is in `~/.appstoreconnect/mirobe-demo-account.txt` on the owner's Mac
  (email + password, Pro until 2026-12-31). Copy them into Play Console by hand. They are deliberately not
  in the repo.
- **Instructions to paste:** "Sign in on the welcome screen (or Profile > Sign in) with the email and password above. The first
  time an AI feature is used (garment tagging, Jev, try-on), the app asks for consent to AI processing. Tap
  Allow. The demo account already has Pro, so no purchase is needed. Try-on: Home > 'Try in the mirror'.
  Stylist: Home > 'Ask Jev'."
- Before submitting, check that the Pro entitlement shows on Android too. If it's a RevenueCat promotional
  entitlement it's cross-platform. If it came from an App Store sandbox purchase, it won't show on Play.

## Data safety form

The answers come from reading the code: `server/src` (routes, `db/index.ts`, `lib/auth.ts`, `ai/*`),
`shared/src`, `mobile/src/lib/voice.ts`, `mobile/src/app/ai-consent.tsx`, `mobile/src/app/delete-account.tsx`,
`mobile/package.json` and `mobile/app.json`.

**Overview questions**

- Does your app collect or share any of the required user data types? **Yes**
- Is all of the user data collected by your app encrypted in transit? **Yes.** The API is HTTPS only
  (`https://mirobe.orbexastudio.com.tr`, behind Cloudflare).
- Which account creation methods does your app support? **Username and password** (email + password).
  Anonymous use without an account is also possible.
- Do you provide a way for users to request that their data is deleted? **Yes.** In-app: Profile > Delete
  account (`DELETE /api/me`, which removes rows and media; backups are purged within 30 days). Web link:
  `https://mirobe.orbexastudio.com.tr/api/legal/delete-account` (live after the next server deploy).

**Sharing:** answer **No** for every type. All transfers go to service providers that process data on our
behalf: OpenRouter, which routes to Google Gemini, ByteDance Seedance and the Jev model; RevenueCat;
Odeaweb (hosting); Cloudflare; Google FCM for push. Play doesn't count that as sharing. No data is sold
or used for ads.

| Play data type | Collected | Shared | Required / optional | Purposes | Ephemeral | Notes |
|---|---|---|---|---|---|---|
| Personal info > **Email address** | Yes | No | Optional (the app works anonymously; needed for an account and AI features) | App functionality, Account management | No | `users.email`. The password is stored hashed (not a Play data type). |
| Personal info > **User IDs** | Yes | No | Required | App functionality, Account management | No | Internal user ID, also used as the RevenueCat app user ID. Anonymous sessions get one too. |
| Personal info > Name | **No** | – | – | – | – | The server accepts an optional `name`, but the app never sends it. Declare it if the register screen starts sending it. |
| Photos and videos > **Photos** | Yes | No | Optional (the user chooses to add clothes or a mirror photo) | App functionality | No | Garment photos, the full-length mirror photo (`avatars`), and generated try-on and studio images, stored on the server (`media`). The phone re-encodes them before upload, which drops EXIF/GPS. |
| Photos and videos > **Videos** | Yes | No | Optional (Pro) | App functionality | No | 5 s motion clips generated from a try-on, stored with the account. |
| Messages > **Other in-app messages** | Yes | No | Optional | App functionality | **Yes** | Messages to Jev (typed or dictated) are sent to the server and the AI provider to produce an answer. The server doesn't store them (`/api/stylist/chat`, no DB write). |
| App activity > **Other user-generated content** | Yes | No | Optional | App functionality | No | Wardrobe item details (category, colours, tags) and saved looks, synced to the account. |
| App activity > **App interactions** | Yes | No | Required | App functionality (monthly plan limits) | No | `usage_events`: counts of AI actions per month. Not used for analytics. |
| Financial info > **Purchase history** | Yes | No | Optional (only subscribers) | App functionality, Account management | No | Subscription status and history through RevenueCat. Payment details stay with Google Play. |
| Device or other IDs | Yes | No | Optional (only if notifications are allowed) | App functionality (payment notices) | No | FCM push token + platform + app language (`push_tokens`). It's deleted on sign-out, on account deletion and when invalid. RevenueCat's SDK may also store a device-scoped ID, which is a second reason to declare this. |
| Audio > Voice or sound recordings | **No** | – | – | – | – | Dictation uses `expo-speech-recognition`, the Android system speech recognizer. Only the resulting text reaches Mirobe, and it's declared under Messages. |
| Location, Contacts, Calendar, Health, Web browsing, Files, Crash logs, Diagnostics, Other performance data | **No** | – | – | – | – | No analytics or crash SDK. Server IP logs are short-lived security logs, not used to derive location. |

Security practices to tick: **data encrypted in transit** and **users can request deletion**. Don't claim
an independent security review.

## Content rating (IARC questionnaire)

- **Category:** "All Other App Types" (utility / productivity / lifestyle). It isn't a game, social app or
  UGC platform: nothing a user uploads is visible to other users.
- Violence, fear, sexuality, nudity, profanity, drugs, alcohol, tobacco, gambling, crude humour: **No**. The
  terms forbid sexual content. AI try-ons dress the user's own photo in their own clothes.
- Do users interact or exchange content with each other? **No.** Jev is an AI stylist, not another user.
- Does the app share the user's current physical location with other users? **No.**
- Does the app allow users to purchase digital goods? **Yes** (subscriptions).
- Unrestricted internet or web browsing? **No.** It only opens the privacy and terms pages.
- If asked about generative AI or AI-generated content: **Yes.** Images, try-ons and short videos of the
  user are generated from the user's own photos, and a chat assistant gives outfit advice.
- **Expected rating:** IARC Generic 3+/7+ · PEGI 3 · ESRB Everyone · USK 0, with the "In-App Purchases"
  interactive element. The App Store rating is 4+.

## Target audience and content

- **Target age groups:** **18 and over** (optionally also 16–17). Don't select any group under 13. The privacy
  policy says the app is not meant for children under 13, and generating images of real people from uploaded
  photos is a feature Play scrutinises when children are in the audience. Selecting teen groups adds
  Families policy checks with no benefit.
- **Appeals to children:** No.
- **News app:** No. **Government app:** No. **Financial features:** None. **Health:** None.
- **Ads:** No ads.

## Gaps and recommended fixes before submitting

1. **Web account-deletion URL: added in code, not deployed yet.** `GET /api/legal/delete-account` (TR/EN,
   `server/src/routes/legal.ts`) gives the in-app steps, an email request path (privacy@orbexastudio.com.tr from
   the account's address, done within 30 days), what is deleted, what is kept (backups ≤ 30 days, short-lived
   logs, store purchase records) and that the Play subscription must be cancelled separately. After the next
   server deploy, enter `https://mirobe.orbexastudio.com.tr/api/legal/delete-account` in the Data safety form.
2. **Privacy policy wording: made platform-neutral in code, not deployed yet.** Voice now says "your phone's
   speech recognition (Apple's on iPhone, Google's on Android)", payment notices go through APNs "or, on Android,
   Google's Firebase Cloud Messaging", and tokens are deleted when "Apple or Google" reports them invalid.
3. **In-app reporting of AI output.** Play's AI-Generated Content policy expects generative AI apps to let
   users report or flag offensive AI-generated content without leaving the app. I found no report/flag action
   in `mobile/src`. Consider adding a "Report this result" action on try-on, studio image, video and Jev replies
   (a mailto or a small `POST /api/reports`).
4. **The terms mention Apple's EULA.** That's fine because the sentence is conditional ("If you downloaded the app
   from the App Store"). Play has no standard EULA, so the Mirobe terms apply alone on Android.
5. **The demo account's entitlement on Android.** Confirm that Pro is visible on an Android build (see App access).