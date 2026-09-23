# Mirobe

AI destekli dijital gardırop. Kıyafetini fotoğrafla, AI etiketlesin. Jev gardırobundan kombin seçsin, sen de kombini kendi fotoğrafında (ve istersen 5 sn videoda) gör.

```
mirobe/
  mobile/      Expo SDK 57 + expo-router (iOS & Android, native app)
  server/      Express + node:sqlite API (auth, sync, AI, kota)
  shared/      Ortak tipler, zod şemaları, etiket taksonomisi, planlar
  legacy-web/  Eski React/Vite + Capacitor sürümü (referans, sonra silinecek)
```

## Mimari

| Katman | Seçim | Neden |
|---|---|---|
| Mobil | Expo (React Native), expo-router, dev build | Gerçek native navigasyon, kamera, haptics, safe-area |
| Yerel veri | `expo-sqlite` + outbox (dirty flag) | Offline kıyafet ekleme, bağlanınca sync |
| Sunucu DB | `node:sqlite` (Node 22.13+'te yerleşik) | Kurulum yok, tek dosya, volume ile kolay deploy |
| Medya | Diskte `DATA_DIR/media`, `MediaStorage` sınıfı | İleride R2/S3 adaptörüyle değiştirilebilir |
| Sync | Push: last-write-wins (`updatedAt`); pull: global `server_seq` cursor | Saat kaymasından etkilenmeyen pull, basit çakışma kuralı |
| Kimlik | İlk açılışta anonim hesap, token `expo-secure-store`'da | Sign in with Apple sonradan aynı kullanıcıya bağlanabilir |

### AI akışı ve maliyet (Eylül 2026)

| İşlem | Motor | Maliyet |
|---|---|---|
| Etiketleme (kategori, renk, kumaş, desen, mevsim, resmiyet, ortam, stil) | `OPENROUTER_VISION_MODEL` (Gemini 2.5 Flash) + zod doğrulama + kontrollü taksonomi | ~$0,001 |
| Kıyafet dekupajı (serili / askıda çekim) | Cihaz üzerinde: iOS Vision, Android ML Kit | $0 |
| Stüdyo packshot (üzerinde giyilen kıyafet ya da isteğe bağlı) | `OPENROUTER_IMAGE_MODEL` (Gemini 3.1 Flash Lite Image) | ~$0,035 |
| Kombin seçimi | **Jev 1.13**, `POST /api/alpha/decisions`. Her slot bir `choice` sorusu, seçenekler gerçek kıyafet id'leri | ~$0,00006, ~360 ms |
| Foto try-on (tüm kombin tek çağrıda) | Gemini 3.1 Flash Image (~17 sn) veya Seedream 4.5 (2K, ~57 sn) | $0,068 / $0,04, önbellekten $0 |
| 5 sn video | OpenRouter Seedance 1.5 Pro, sessiz | 720p ~$0,13, 480p ~$0,058 |
| Canlı ayna (şimdilik kapalı, `LIVE_MIRROR_ENABLED`; oturum başına en çok 30 sn) | fal `decart/lucy2-vton/realtime` + WebRTC | $0,02/sn |

Etiketler sabit değil, tamamen AI'dan gelir. AI başarısız olursa kıyafet `failed` olarak işaretlenir; kullanıcı yeniden etiketleyebilir ya da etiketleri elle düzenleyebilir. Jev kullanılamazsa, etiket skorlarına dayalı sezgisel yedek devreye girer (OpenRouter kredisi bittiyse değil: o zaman sohbet mesajı hata verir ve iade edilir).

**Kredi bitince:** OpenRouter `402` dönünce istek `503 PROVIDER_CREDITS` olur, ayrılan hak iade edilir (etiketleme, stüdyo, deneme, video, Jev sohbeti) ve sunucu en çok 10 dakikada bir `[mirobe] ALERT: AI provider out of credits (openrouter)` satırı yazar (`docker logs … | grep ALERT`). Kullanıcı yalnızca "Yapay zekâ özellikleri şu anda kullanılamıyor. Biraz sonra tekrar dene." görür.

### Stüdyo görseli (packshot)

- **İstem:** `packshotPrompt()` (`server/src/ai/tagging.ts`) yeni bir ürün çizdirmez, fotoğraftaki **aynı** kıyafeti ister: renkler ve oranları, desen tipi ve **yönü** (dikey çizgi dikey kalır; çizgi genişliği ve sırası korunur, bant ya da blok olmaz), baskı / logo / yazı harfi harfine (uydurma, çevirme, düzeltme yok; okunmayan yazı okunmayan baskı olarak kalır), kumaş dokusu, yaka, manşet, kalıp ve boy. Yalnızca kişi / arka plan / kırışıklık kalkar; üzerinde ya da açılı çekilmişse o kıyafetin düz ön görünümü kurulur. Eskiden istemdeki "No text" kuralı kıyafetin üstündeki yazıyı da bozuyordu; artık yalnızca *eklenen* yazı yasak.
- **Etiketler kısıt olarak:** etiketlenmiş (`taggingStatus = ready`) parçada ad, kategori, renkler (hex ile), desen, kumaş ve detaylar istemde "hard constraints" olarak gider. Etiketleme istemi çizgili parçalarda yönü ("dikey çizgili") ve baskılı yazıyı ("yazı baskılı") detaylara yazdırır.
- **Model:** maliyet aynı kalsın diye `OPENROUTER_IMAGE_MODEL` hâlâ `google/gemini-3.1-flash-lite-image` (~$0,035). Sadakat yine zayıf kalırsa `OPENROUTER_IMAGE_MODEL=google/gemini-3.1-flash-image` yap (yaklaşık 2 kat maliyet); kod değişikliği gerekmez.
- **Çekerken:** tarama ekranında "Stüdyo görseli de oluştur · 1 görsel (bu ay kalan N)" seçeneği var (varsayılan açık, cihazda hatırlanır; hak yoksa kapalı görünür, "Planları gör" bağlantısıyla). Açıkken her yeni parça sıraya girer (`kv studio.auto`); parça etiketlenince (görsel etiketleri kullanır) stüdyo görseli bir kez, ek onay sorulmadan istenir. Maliyet tarama ekranında yazılı. Sıra yalnızca izin varken işler; aynı parça için ikinci istek mevcut isteğe katılır (tek ücret). Galeriden çoklu eklemede hak bittiği anda kalan parçalar görselsiz eklenir ve bu bir kez söylenir.

### Fotoğraf yönü

- Uygulama dikey kilitli, ama kamera yerçekimini izler: telefon yana eğikken çekilen foto yatay kaydediliyordu ve kıyafet detayda (ve AI'da) 90° yatık görünüyordu. `CameraSurface` artık expo-camera'nın `responsiveOrientationWhenOrientationLocked` yönünü izler ve yatay çıkan fotoğrafı ekranda görünen hâle döndürür (`screenRotation`, `alignPhoto` — `mobile/src/lib/media.ts`). Tarama, avatar ve aynadaki deneme karesi bu yoldan geçer.
- "Üzerimde" modunda ön kamera fotoğrafı ayna görüntüsü olarak değil düz kaydedilir, baskılı yazılar okunur kalır.
- Saklanan / yüklenen her foto `persistPhoto` ile yeniden kodlanır: EXIF yönü piksellere işlenir, dosyada yön etiketi kalmaz (AI modelleri EXIF'i okumaz). Galeriden seçilenler de dahil.
- **Sunucu:** görüntü kütüphanesi (sharp vb.) yok, ağır native bağımlılık eklenmedi. `POST /api/media` yalnızca JPEG'in EXIF yönünü okur (`server/src/lib/exif.ts`) ve 1 dışında bir değer görürse `[mirobe] upload with EXIF orientation …` uyarısı yazar (eski uygulama sürümü). Sunucuda döndürme gerekirse `sharp` ile `rotate()` (EXIF'e göre) buraya eklenebilir.

## Yapay zekâ ile işleme izni (App Store 5.1.2(i))

Kıyafet fotoğrafları, ayna fotoğrafı / kamera karesi ve Jev'e yazılanlar üçüncü taraf AI'ya (OpenRouter → Google Gemini; kombin seçimi Jev modeli; video ByteDance Seedance) ancak hesap açıkça izin verdikten sonra gider.

- **Sunucu:** `users.ai_consent_at` (migration 7; mevcut herkes için `NULL`). `POST /api/me/ai-consent` `{granted: boolean}` (oturum gerekir) izni kaydeder ya da geri alır, `{aiConsent}` döner; tekrar verilen izin ilk zamanı korur. `GET /api/me` `aiConsent: boolean` ekler (eski istemciler görmezden gelir). Tüm AI yolları (`/api/garments/:id/analyze`, `/api/garments/:id/packshot`, `/api/stylist/decide`, `/api/stylist/chat`, `/api/tryons`, `/api/tryons/:id/video`, açıksa `/api/live/start` ve `/api/live/token`) sırasıyla `401` → `403 AUTH_REQUIRED` → `403 AI_CONSENT_REQUIRED` kontrolünden geçer; bu kontroller kota ayırmadan ve sağlayıcı çağrısından önce yapılır. `/api/live/stop` (yalnızca süre kapatır) kapıya takılmaz. Hesap silme izni de siler.
- **Uygulama:** İlk AI eyleminde tek bir izin ekranı açılır (`mobile/src/app/ai-consent.tsx`; modal ekranların üstünde de açılabilsin diye `<Modal>` değil şeffaf modal route, bildirim açıklamasıyla aynı görünüm): kıyafet tarama / galeriden ekleme (ilk parça eklendikten sonra), yeniden etiketleme, stüdyo görseli, deneme, video, Jev mesajı / mikrofon ve Keşfet'teki hızlı kartlar (Jev açılınca, mesaj gitmeden önce). "İzin ver" izni kaydeder ve eylem sürer; "Şimdi değil" eylemi çalıştırmaz. İzinsiz eklenen parçalar etiketlenmeden kalır ("İzin verince etiketlenir"); parça ekranındaki nota ya da tarama ekranındaki "etiketleme iznini bekliyor" yazısına dokununca izin sorulur. Profil → Gizlilik → "Yapay zekâ ile işleme" anahtarı izni geri alır ya da aynı ekranla yeniden verir. Sunucu bir kullanıcı eyleminde yine `AI_CONSENT_REQUIRED` derse (başka cihazda geri alınmış) ekran yeniden açılır; arka plandaki etiketleme ise sormaz, bekler.
- **Kayıt / giriş sonrası:** hesap oluşturulunca ya da giriş yapılınca izin yoksa aynı ekran, uygulama sekmelere döner dönmez bir kez kendiliğinden açılır (`useAiConsentAfterSignIn`, `kv ai.consent.prompt = due`). "Şimdi değil" hatırlanır, her açılışta sorulmaz; ama eylem başındaki kapı kalır: izin hâlâ yoksa ilk AI eyleminde yine sorulur. Anonim kullanıcıya gösterilmez; araya bir eylemin izin ekranı girdiyse otomatik soru düşer.
- **Eski sunucuyla:** `aiConsent` alanı yoksa "henüz sorulmadı" sayılır; `POST` `404` dönerse izin cihazda tutulur (`kv ai.consent = local`) ve uygulama çalışmaya devam eder. Sunucu güncellenince bu izin bir kez sunucuya yazılır, kullanıcıya tekrar sorulmaz.
- **Dağıtım sırası:** önce izin ekranlı uygulama sürümü (eski sunucuyla da çalışır), sonra sunucu. Sunucu güncellenince mevcut her hesap (App Review demo hesabı dahil) ilk AI eyleminde bir kez izin verir; izin ekranı olmayan eski build'lerde AI özellikleri genel hata gösterir.

## Abonelikler

Planlar `shared/src/plans.ts` içindedir (`PLANS`, `REVENUECAT_PRODUCTS`, `REVENUECAT_ENTITLEMENTS`). Plan hakları aylık **adet** olarak sayılır (UTC ay başı sıfırlanır): her işlem, sağlayıcıya maliyeti ne olursa olsun 1 sayılır. AI özellikleri her planda giriş yapmış hesap ister.

| Plan | Aylık | Yıllık | Görsel | Video | Jev mesajı | AI etiketleme (adil kullanım) |
|---|---|---|---|---|---|---|
| Free | 0 | 0 | 3 | 0 | 30 | 20 |
| Plus | 499,99 TL / $9.99 | 4.999,99 TL / $99.99 | 100 | 0 | 300 | 200 |
| Pro | 1.199,99 TL / $19.99 | 11.999,99 TL / $199.99 | 200 | 8 | 750 | 450 |

- **Görsel:** her foto try-on ve her AI stüdyo packshot'ı 1. Önbellekten gelen try-on sayılmaz.
- **Video:** her 5 sn hareketli klip 1; `VIDEO_RESOLUTION` (480p / 720p) sayıyı değiştirmez. Videosu 0 olan plan (Free, Plus) klip isteyince `402 PLAN_REQUIRED` alır; uygulama Pro'yu önerir.
- **Jev mesajı:** her Jev kombin kararı ve **her** stilist sohbet mesajı (sohbet dahil) 1.
- **AI etiketleme:** kıyafet başına 1. Ödeme ekranında, profilde ve `/api/me` yanıtında görünür.
- `/api/me` kullanımı `{ planId, periodStart, images, videos, stylist, taggings }` olarak döner, her kova `{ used, limit }`. `used`, bu ayki kullanım kayıtlarının **sayısıdır**; sağlayıcı hatasında kayıt silinerek iade edilir. Birimle tutulmuş eski kayıtlar (ör. try-on başına 20) DB migration 4 ile kovalarına taşınır ve 1 sayılır.
- **Canlı ayna** hiçbir planda yok ve uygulamada gizli (`shared/src/features.ts` → `LIVE_MIRROR_ENABLED = false`). Sunucuda `LIVE_MIRROR_ENABLED=true` verilmedikçe her `/api/live/*` yolu, kimlik ve kota kontrolünden önce `404 FEATURE_DISABLED` döner. Kod sonraki bir sürüm için duruyor; yeniden açılırsa bir oturum 1 video sayılır.

Her hak sonuna kadar kullanılırsa aylık AI maliyeti (görsel ≈ $0,035 `gemini-3.1-flash-lite-image`, 480p klip ≈ $0,058, Jev ≈ $0,004, etiketleme ≈ $0,001):

- Free: 3 × $0,035 + 30 × $0,004 + 20 × $0,001 ≈ **$0,25 / ay** (OpenRouter'ın %5,5 kredi komisyonuyla $0,26)
- Plus: 100 × $0,035 + 300 × $0,004 + 200 × $0,001 ≈ **$4,90 / ay** (komisyonla $5,17)
- Pro: 200 × $0,035 + 8 × $0,058 + 750 × $0,004 + 450 × $0,001 ≈ **$10,91 / ay** (komisyonla $11,51)

Jev için $0,004 kötü senaryodur (kombin turu); sohbet mesajları ≈ $0,001, tipik ortalama ≈ $0,0015. Tipik değerle üst sınır Plus ≈ $4,38, Pro ≈ $9,54.

Try-on ve stüdyo görseli `gemini-3.1-flash-image` ile yapılırsa (≈ $0,068, iki kat pahalı) üst sınır Free ≈ $0,42, Plus ≈ $7,30, Pro ≈ $15,11 olur ve Plus/Pro fiyatları zarar ettirir; bu yüzden varsayılan model Flash Lite'tır. 720p klipler (≈ $0,13) Pro'ya ≈ $0,58 ekler.

Eski `premium` plan kimliği `plus` olarak okunur (DB migration 3 ve `mirobe_premium` / `premium` entitlement eşlemesi).

Fiyatlar uygulamada mağazadan gelir (`product.priceString`): Türkiye storefront'u TL, diğerleri USD görür. RevenueCat yapılandırılmamışsa ya da paketler yüklenemezse ödeme ekranı cihaz bölgesi `TR` ise `priceTry`, değilse `priceUsd` gösterir.

### Nasıl çalışır

- Ödeme RevenueCat üzerinden yapılır (`react-native-purchases`, iOS'ta StoreKit 2, Android'de Play Billing). RevenueCat app user id'si **sunucudaki kullanıcı id'sidir**: `mobile/src/lib/billing.ts` kök layout'taki `userId` değiştikçe `Purchases.logIn` / `logOut` çağırır (kayıt aynı id'yi korur, giriş/çıkış/hesap silme kullanıcıyı değiştirir).
- Satın alma ve geri yükleme **kayıtlı hesap** ister; anonim kullanıcı `/login?next=/paywall`'a gider. Başarılı satın almadan sonra uygulama `POST /api/billing/sync` çağırır; sunucu planı önbelleği atlayarak RevenueCat REST API'sinden okur.
- Sunucu planı hiçbir zaman istemciden ya da webhook gövdesinden almaz: `server/src/lib/entitlements.ts` aboneyi RevenueCat v1 API'sinden sorgular (5 sn zaman aşımı, 10 dk önbellek, hata olursa önbellekteki plan ve 1 dk bekleme). Entitlement; süresi dolmamışsa, faturalama sorunu sonrası **grace period** sürüyorsa ya da süresizse (lifetime) etkindir.
- `POST /api/billing/revenuecat-webhook` (`server/src/routes/billing.ts`): `Authorization` başlığı `REVENUECAT_WEBHOOK_AUTH` ile sabit zamanlı karşılaştırılır (yanlışsa 401). Olaydaki kullanıcıların (TRANSFER'de `transferred_from` / `transferred_to` dahil) önbelleği silinir, yanıt hemen 200 döner, plan arka planda REST API'den yeniden okunur. Olay id'leri `billing_events` tablosunda tutulur; tekrar gelen olay işlenmez.
- Android'de plan değişikliği eski ürünle yapılır: yükseltme `WITH_TIME_PRORATION` (hemen), düşürme `DEFERRED` (dönem sonunda). iOS'ta aynı abonelik grubundaki değişikliği App Store yönetir.
- Ödeme ekranı: otomatik yenileme metni, dönem başına fiyat, "Satın alımları geri yükle", "Aboneliği yönet" (iOS'ta App Store sayfası, Android'de Play abonelikleri), Kullanım Koşulları (iOS'ta Apple standart EULA) ve Gizlilik Politikası bağlantıları.
- Yasal sayfalar `GET /api/legal/privacy` ve `GET /api/legal/terms` altında **taslak** olarak sunulur (`server/src/routes/legal.ts`; Cloudflare kuralı yalnızca `/api` yollarını geçirdiği için). Gizlilik politikası push bildirimlerini (saklanan push token, dil ve tercihler; ne zaman silindiği; nasıl kapatıldığı), yapay zekâ ile işleme iznini ve uygulama içi bildirimleri de anlatır. Yayından önce metinleri ve iletişim adresini gözden geçir. App Store Connect'teki Privacy Policy URL'si: `https://mirobe.orbexastudio.com.tr/api/legal/privacy`.

### Kurulum kontrol listesi (senin yapman gerekenler)

**App Store Connect**

1. *Business* → Paid Apps sözleşmesini imzala; vergi (W-8BEN-E) ve banka bilgilerini tamamla. Bu bitmeden abonelikler sandbox'ta bile yüklenmez.
2. *Certificates, Identifiers & Profiles* → `com.orbexastudio.mirobe` App ID'sinde In-App Purchase açık olsun (varsayılan olarak açıktır; ayrı entitlement dosyası gerekmez).
3. Uygulama → *Monetization → Subscriptions* → **"Mirobe"** adlı bir abonelik grubu oluştur. Seviyeler: **Seviye 1: Pro** (`mirobe_pro_annual`, `mirobe_pro_monthly`), **Seviye 2: Plus** (`mirobe_plus_annual`, `mirobe_plus_monthly`). Böylece Plus → Pro yükseltmesi hemen, Pro → Plus düşürmesi dönem sonunda olur.
4. Dört ürünü ekle (süre 1 ay / 1 yıl). Fiyat: temel ülke ABD'de $9.99 / $99.99 (Plus), $19.99 / $199.99 (Pro); Türkiye için elle 499,99 / 4.999,99 TL (Plus), 1.199,99 / 11.999,99 TL (Pro). Diğer ülkeler ABD fiyatından Apple eşdeğerleriyle. Bu fiyatlar 2026-09-23'te App Store Connect'e API ile girildi.
5. Her ürün ve grup için TR ve EN yerelleştirmesi (görünen ad + açıklama), inceleme için bir **ekran görüntüsü** (ödeme ekranı) ve inceleme notu ekle. İlk abonelikler uygulama sürümüyle birlikte incelemeye gönderilir.
6. *App Information* → Privacy Policy URL'si ve (isteğe bağlı) özel EULA; uygulama açıklamasının sonuna Kullanım Koşulları (EULA) ve Gizlilik Politikası bağlantılarını yaz (inceleme bunu ister).
7. *Users and Access → Integrations → In-App Purchase* → bir **In-App Purchase anahtarı (.p8)** oluştur; Key ID ve Issuer ID ile birlikte RevenueCat'e yükle (StoreKit 2 doğrulaması için gerekli). Aynı yerden App Store Connect API anahtarı da RevenueCat'e verilebilir (ürün içe aktarma).
8. Uygulama → *App Information → App Store Server Notifications* → Production ve Sandbox için **Version 2** URL'si olarak RevenueCat'in verdiği adresi yaz (RevenueCat → iOS app ayarları → "Apple Server to Server notification URL").
9. *Users and Access → Sandbox* → bir **Sandbox test hesabı** oluştur (tercihen TR storefront'lu bir tane, bir de ABD).

**Google Play Console**

1. *Settings → Payments profile* → ödeme (merchant) hesabını aç, vergi ve banka bilgilerini doldur.
2. Uygulamayı en az bir kez bir test kanalına yükle (Play, faturalama izni `com.android.vending.BILLING` olan bir AAB görmeden ürün oluşturmaya izin vermez; izin SDK'dan otomatik gelir).
3. *Monetize → Subscriptions* → dört abonelik: `mirobe_plus_monthly`, `mirobe_plus_annual`, `mirobe_pro_monthly`, `mirobe_pro_annual`; her birinde otomatik yenilenen tek base plan (`monthly` / `annual`), TR fiyatı elle TL, diğer ülkeler USD'den. Play ürünleri RevenueCat'e `productId:basePlanId` olarak gelir; uygulama `:` öncesini eşleştirir.
4. Google Cloud'da bir **service account** oluştur, JSON anahtarını indir; Play Console → *Users and permissions* ile bu hesabı davet et ve "View financial data", "Manage orders and subscriptions" izinlerini ver. JSON'u RevenueCat → Android app ayarlarına yükle (izinlerin etkinleşmesi 24-36 saat sürebilir).
5. *Monetize → Monetization setup → Real-time developer notifications* → RevenueCat'in verdiği **Pub/Sub topic**'ini gir (RevenueCat → Android app ayarlarında "Connect to Google" ile otomatik oluşturulur) ve test bildirimi gönder.
6. *Settings → License testing* → test Google hesaplarını ekle.

**RevenueCat**

1. Proje oluştur; bir **iOS app** (`com.orbexastudio.mirobe`, .p8 anahtarı + App Store Server Notifications) ve bir **Android app** (`com.orbexastudio.mirobe`, service account JSON + Pub/Sub) ekle.
2. *Products* → dört ürünü her iki mağaza için içe aktar ya da elle ekle.
3. *Entitlements* → `mirobe_plus` (iki Plus ürünü) ve `mirobe_pro` (iki Pro ürünü). Eski `mirobe_premium` varsa silme: sunucu onu Plus sayar.
4. *Offerings* → `default` offering'i **current** yap; paketler: `plus_monthly`, `plus_annual`, `pro_monthly`, `pro_annual` (özel kimlik; bir offering'de `$rc_monthly` yalnızca bir kez kullanılabilir). Her pakete iOS ve Android ürününü bağla. Uygulama paketleri ürün kimliğine göre bulur; plan başına ayrı offering de çalışır.
5. *Integrations → Webhooks* → URL `https://mirobe.orbexastudio.com.tr/api/billing/revenuecat-webhook`, **Authorization header** değeri olarak uzun rastgele bir değer (`openssl rand -hex 32`); aynı değeri sunucuda `REVENUECAT_WEBHOOK_AUTH` yap. Kaydettikten sonra "Send test event" ile 200 döndüğünü gör.
6. *Project settings → API keys* → **public SDK anahtarları** (iOS `appl_…`, Android `goog_…`) → `mobile/.env.local` içinde `EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` ve `mobile/eas.json` içindeki `preview` / `production` profillerinin `env` alanı. **Secret API key (v1, `sk_…`)** → sunucuda `REVENUECAT_SECRET_KEY` (asla `EXPO_PUBLIC_` ile başlamaz, uygulamaya girmez).
7. iOS app ayarlarında restore davranışını "Transfer to new App User ID" (varsayılan) olarak bırak: aynı Apple kimliğiyle başka Mirobe hesabına geri yükleme aboneliği o hesaba taşır ve webhook iki tarafın planını da yeniler.

**Sunucu ortamı (production)**

```
REVENUECAT_SECRET_KEY="sk_…"          # RevenueCat secret v1 anahtarı
REVENUECAT_WEBHOOK_AUTH="…"           # webhook Authorization değeri, RevenueCat'tekiyle aynı
```

`DEV_PLAN_OVERRIDE` production'da yok sayılır. Mobil anahtarlar değişince yeni bir build gerekir (EXPO_PUBLIC değerleri pakete gömülür).

### Test

- **Simülatörde, App Store Connect olmadan (StoreKit Configuration):** `mobile/storekit/Mirobe.storekit` (ABD, USD) ve `Mirobe-TR.storekit` (Türkiye, TL) dört ürünü "Mirobe" grubunda içerir. `mobile/ios/` prebuild çıktısı olduğu için (git'te yok) bir kopya `mobile/ios/Mirobe/` altında durur; `expo prebuild --clean` sonrası yeniden kopyala: `cp mobile/storekit/*.storekit mobile/ios/Mirobe/`. Xcode'da `mobile/ios/Mirobe.xcworkspace` → dosyayı projeye sürükle (target'a ekleme) → *Product → Scheme → Edit Scheme… → Run → Options → StoreKit Configuration* → `Mirobe.storekit` ya da `Mirobe-TR.storekit` seç → Xcode'dan çalıştır. RevenueCat bu satın alımları doğrulayabilsin diye Xcode'da `.storekit` dosyası açıkken *Editor → Save Public Certificate* ile sertifikayı kaydet ve RevenueCat iOS app ayarlarındaki "StoreKit Configuration file" / test sertifikası alanına yükle. Ürün kimlikleri RevenueCat'te de tanımlı olmalı (offering boşsa ödeme ekranı "Mağaza ürünleri henüz hazır değil" der). Yenileme hızını ve Ask to Buy / başarısız işlem senaryolarını *Debug → StoreKit → Manage Transactions* ve dosyanın Editor ayarlarından değiştirebilirsin.
- **Sandbox (gerçek cihaz):** cihazda *Ayarlar → App Store → Sandbox Account* ile test hesabına gir; TestFlight ya da dev build ile satın al. Sandbox'ta aylık abonelik ~5 dakikada yenilenir.
- **Android:** license tester hesabıyla internal testing kanalındaki build'den satın al; test kartı "Slow test card" ile bekleyen ödeme (pending) senaryosu da denenebilir.
- **Sunucu:** `npm test` webhook kimlik doğrulamasını, idempotency'yi, TRANSFER'i, grace period'u ve `/api/billing/sync`'i fetch taklidiyle test eder. Yerelde:

  ```bash
  PORT=3999 DATA_DIR=/tmp/mirobe-billing REVENUECAT_WEBHOOK_AUTH=test npm run dev -w @mirobe/server
  curl -i -X POST localhost:3999/api/billing/revenuecat-webhook -H 'Content-Type: application/json' -d '{"event":{"id":"e1","type":"TEST"}}'                          # 401
  curl -i -X POST localhost:3999/api/billing/revenuecat-webhook -H 'Authorization: test' -H 'Content-Type: application/json' -d '{"event":{"id":"e1","type":"TEST"}}'  # 200
  ```

## Bildirimler

İki tür push bildirimi var, ikisi de kayıtlı hesap ve kullanıcı izni ister; bir de izin gerektirmeyen uygulama içi bildirimler var:

- **Günlük kombin hatırlatması (15:00):** cihazda planlanan yerel bildirim, sunucu gerekmez (`mobile/src/lib/notifications.ts`, `reminders.ts`; metinler `i18n.ts` → `reminders`). Sonraki 14 gün tek tek planlanır; iOS'ta saat dilimi sabitlenmemiş takvim tetikleyicisi kullanıldığı için seyahatte de yerel 15:00'tir. Uygulama her açılışta ve öne gelişte, gardırop ya da dil değişince yeniden planlar; uygulamanın açıldığı gün hatırlatma gelmez. Bazı günler gardıroptaki gerçek bir parçanın adı geçer (AI çağrısı yok). Dokununca Jev açılır ve soru yazılı gelir ama gönderilmez (Jev hakkı harcanmaz). Çıkışta, hesap silinince ve anahtar kapanınca iptal edilir.
- **Abonelik bildirimleri:** RevenueCat webhook'u 200 döndükten sonra sunucu APNs ile gönderir (`server/src/lib/subscriptionNotices.ts`, `lib/apns.ts`: `node:http2` + ES256 JWT, ek bağımlılık yok). Ödeme alındı: `INITIAL_PURCHASE` (ücretsiz deneme hariç), kullanıcının kendi yenilediği `RENEWAL` (otomatik yenileme değil, aşağıya bak), `PRODUCT_CHANGE` (yalnızca yükseltme). Ödeme alınamadı: `BILLING_ISSUE`; dokununca ödeme ekranı mağazanın abonelik yönetimini açar. Aynı olay iki kez bildirilmez (`billing_events`; olay id'si olayın yaptığı değişikliklerle aynı transaction'da yazılır, hata olursa RevenueCat'in tekrar denemesi yeniden işlenir). Kullanıcı Profil'den kapatabilir (`users.notify_subscription`, varsayılan açık; uygulama içi bildirimleri de kapsar). Bildirim, olayın mağaza ortamından bağımsız olarak alıcının bütün iOS cihazlarına gider; her token kendi APNs ortamından gönderilir (dev build sandbox, TestFlight/App Store production). Böylece TestFlight'taki sandbox satın alımı da bildirim alır; bildirim yalnızca alıcının kendi cihazlarına gittiği için bu güvenlidir.
- **Yenileme kuralı:** otomatik yenilemede push gitmez; yalnızca abonelik sona erip kullanıcı onu yeniden aldığında gider. Sunucu webhook'lardan kullanıcı başına iki şey tutar (migration 6): bilinen son dönem sonu (`users.subscription_expires_at`: `INITIAL_PURCHASE`, `RENEWAL`, `PRODUCT_CHANGE`, `EXPIRATION` ve dönemi uzatan `SUBSCRIPTION_EXTENDED` olaylarının `expiration_at_ms`'i; `BILLING_ISSUE` gelince, daha geçse `grace_period_expiration_at_ms`'e yani grace period sonuna uzatılır) ve `EXPIRATION` ile konan "sona erdi" işareti (`users.subscription_lapsed_at`; `INITIAL_PURCHASE` ya da `RENEWAL` gelince silinir). `TRANSFER` (başka hesaba geri yükleme) iki taraftaki bilgiyi de sıfırlar. Bir `RENEWAL`, işaret varsa ya da `purchased_at_ms` bilinen son dönem sonundan **24 saatten fazla** sonraysa (kaçırılmış bir `EXPIRATION`) kullanıcının kendi yenilemesi sayılır ve "Aboneliğin yenilendi / planın yeniden etkin" gider. Aksi halde (normal otomatik yenileme, deneme dönüşümü, grace period içinde başarılı olan faturalama yeniden denemesi) bir şey gitmez. Karar olay kaydedilmeden önceki duruma göre verilir; geçmişi bilinmeyen (kuraldan önceki) bir aboneliğin ilk yenilemesi otomatik sayılır.
- **Uygulama içi bildirimler:** `UNCANCELLATION` (otomatik yenileme yeniden açıldı) push göndermez, `user_notices` tablosuna (migration 6) okunmamış bir kayıt bırakır. `GET /api/me` okunmamışları `notices: [{ id, kind, plan? }]` olarak döner (en yeni önce, en çok 5; bilinmeyen üründe `plan` yok). 30 günden eski kayıtlar, görülmüş olsun olmasın, listelenmez ve sunucunun 5 dakikalık süpürmesinde silinir (gizlilik politikası "en fazla 30 gün" der). Uygulama bunu açılışta ve öne gelişteki eşitlemede alır, sekmelerin üstünde birkaç saniyelik bir banner gösterir ("Otomatik yenileme yeniden açık" / "Mirobe Pro planın devam edecek.") ve `POST /api/notices/:id/seen` ile görüldü işaretler (yalnızca kendi kaydı; başkasınınki 404). Aynı türden yeni kayıt okunmamış eskisinin yerine geçer; `CANCELLATION` ya da `EXPIRATION` okunmamış kaydı geri çeker. Alanı göndermeyen eski sunucuda uygulama hiçbir şey yapmaz. Hesap silme kayıtları da siler.
- **İzin:** ilk açılışta sorulmaz. Parça eklendikten ya da deneme bittikten sonra, sistem penceresinden önce iki türü anlatan bir uygulama içi açıklama çıkar (App Store 4.5.4). Profil → Bildirimler'de iki anahtar var; kapalı izin için Ayarlar'a yönlendirilir.
- **API:** `POST /api/push/tokens` `{token, platform, environment, lang}` (bilinen token onu kaydeden kullanıcıya geçer), `DELETE /api/push/tokens` `{token}`, `GET` / `PUT /api/me/notification-settings` `{subscription}`, `POST /api/notices/:id/seen`. Tablolar `push_tokens` (migration 5) ve `user_notices` (migration 6); hesap silme ikisini de siler. APNs 410 / `BadDeviceToken` dönen token silinir.

**Apple Developer:** *Certificates, Identifiers & Profiles → Keys → +* → "Apple Push Notifications service (APNs)" → `AuthKey_<KEYID>.p8` dosyasını indir (yalnızca bir kez indirilebilir). Aynı anahtar sandbox ve production için geçerlidir. `com.orbexastudio.mirobe` App ID'sinde *Push Notifications* açık olmalı (Xcode otomatik imzalama ya da EAS açar).

**Sunucu ortamı (production):**

```
APNS_KEY_ID="…"                       # anahtarın Key ID'si (10 karakter)
APNS_TEAM_ID="F293R6XW2Y"
APNS_KEY_BASE64="…"                   # base64 -i AuthKey_<KEYID>.p8 | tr -d '\n'   (Linux: base64 -w0)
APNS_TOPIC="com.orbexastudio.mirobe"
```

Anahtar yoksa sunucu bir kez log yazar ve bildirim göndermez. Açılışta `apns: on/off` yazılır.

**Native:** `expo-notifications` config plugin'i `aps-environment` entitlement'ını ekler (`development`; App Store / TestFlight dışa aktarımında dağıtım profili `production` yapar). Modül eklendikten sonra yeni bir native build gerekir; eski build'lerde bildirim kodu hiçbir şey yapmaz ve Profil'de Bildirimler bölümü görünmez.

**Deneme (dev build, simülatörde de):** izin verip giriş yaptıktan sonra, kullanıcının id'siyle:

```bash
curl -X POST localhost:3000/api/billing/revenuecat-webhook -H "Authorization: $REVENUECAT_WEBHOOK_AUTH" -H 'Content-Type: application/json' \
  -d '{"event":{"id":"push-test-1","type":"BILLING_ISSUE","environment":"SANDBOX","app_user_id":"usr_…","product_id":"mirobe_pro_monthly"}}'
```

Uygulama içi bildirim için aynı komutu `"type":"UNCANCELLATION"` ve yeni bir `id` ile gönder; uygulama öne gelince banner'ı gösterir.

## Puanlama isteği

Uygulama yalnızca sistemin puanlama penceresini açar (`expo-store-review`, `mobile/src/lib/review.ts`; özel "bizi puanla" ekranı yok, App Store 1.1.7 / 5.6.1): 3. başarılı (önbellekten gelmeyen) denemeden ya da 2. kaydedilen kombinden sonra, hangisi önce gelirse. Sürüm başına en çok bir kez, ilk kullanım gününde asla, kredi uyarısı ekrandayken asla; iOS yine de göstermeyebilir (TestFlight'ta hiç göstermez). Sayaçlar cihazın yerel tablosundadır ve çıkış yapınca silinmez. Native modül bildirimlerdeki gibi tembel yüklenir: modülü içermeyen eski build'lerde hiçbir şey yapmaz. Modül eklendiği için `cd mobile/ios && pod install` ve yeni bir native build gerekir.

## Çalıştırma

Gereksinimler: Node 22.13+ (Mac'te Node 26), Xcode (iOS için), Android Studio (Android için).

```bash
npm install                      # tüm workspace'ler
cp .env.example .env             # anahtarları doldur
npm run server                   # API → http://localhost:3000
cd mobile && npx expo run:ios    # dev build + simülatör (ilk derleme ~10 dk)
```

- Geliştirmede `EXPO_PUBLIC_API_URL` boş bırakılabilir: uygulama Metro'nun host'unu (Mac'in LAN IP'si) kullanır. Aynı Wi-Fi'daki telefon ek ayar olmadan bağlanır.
- `DEV_PLAN_OVERRIDE=plus` ya da `pro` ile, RevenueCat olmadan planlar yerelde test edilebilir. Video klipler yalnızca `pro` ile açılır; canlı ayna ayrıca `LIVE_MIRROR_ENABLED=true` ister.
- Uygulama Expo Go'da çalışmaz (WebRTC, konuşma tanıma, RevenueCat ve cihaz üzerinde dekupaj native modül). `expo-dev-client` ile dev build kullanılır.
- **Simülatörde kamera:** iOS Simülatörü'nde kamera yok. `cd mobile && npm run sim-camera` Mac'in webcam'ini `localhost:8090` üzerinden yayınlar; geliştirme modunda simülatördeki tarama, avatar ve ayna ekranları bu görüntüyü kullanır. Webcam yalnızca bir kamera ekranı açıkken açılır. Kamerasız denemek için `npm run sim-camera -- --test` kullanılabilir. Canlı WebRTC modu bu yolla çalışmaz; onun için gerçek cihaz ya da SimCam gibi bir enjeksiyon aracı gerekir.

## Testler

```bash
npm test          # sunucu: auth, medya, sync (LWW, silme işareti, sahiplik), stilist, kota, try-on önbelleği, AI izni, kredi bitince iade, packshot istemi, EXIF yönü
npm run lint      # tsc: server + mobile
```

## Yayın

**Sunucu** tek bir konteyner olarak çalışır; SQLite ve medya `/app/data` volume'undadır:

```bash
docker build -t mirobe-api .
docker run -p 3000:3000 -v mirobe-data:/app/data --env-file .env mirobe-api
```

Railway, Fly.io ve Render'da bir volume bağlamak yeterlidir. Birden fazla instance gerektiğinde `MediaStorage` bir S3/R2 adaptörüyle değiştirilir; SQLite de LiteFS ya da Turso'ya taşınır.

**Mobil:** `cd mobile && eas build --profile production`. API adresi `eas.json` içindeki `EXPO_PUBLIC_API_URL` ile verilir.
