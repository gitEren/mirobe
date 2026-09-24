import express from 'express';

/**
 * Privacy policy, terms and support pages linked from the paywall and the store listings.
 * They live under /api because the Cloudflare rule in front of the API only lets /api
 * paths through. `?lang=tr|en` picks the language, otherwise the browser's
 * Accept-Language decides (Turkish for tr, English for everything else).
 *
 * Keep the privacy text in line with the App Store "App Privacy" answers: email, photos
 * and videos, other user content, user ID, purchase history and product interaction,
 * all linked to the account, none used for tracking.
 */
const APPLE_EULA = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
const PRIVACY_MAIL = 'privacy@orbexastudio.com.tr';
const SUPPORT_MAIL = 'support@orbexastudio.com.tr';
const BASE = '/api/legal';

type Lang = 'tr' | 'en';
type Doc = 'privacy' | 'terms' | 'support' | 'delete-account';

const mail = (address: string) => `<a href="mailto:${address}">${address}</a>`;

const TITLES: Record<Doc, Record<Lang, string>> = {
  privacy: { tr: 'Gizlilik Politikası', en: 'Privacy Policy' },
  terms: { tr: 'Kullanım Koşulları', en: 'Terms of Use' },
  support: { tr: 'Mirobe Destek', en: 'Mirobe Support' },
  'delete-account': { tr: 'Mirobe hesabını silmek', en: 'Deleting your Mirobe account' },
};

const UPDATED: Record<Lang, string> = { tr: 'Son güncelleme 24 Eylül 2026', en: 'Last updated September 24, 2026' };

const BODIES: Record<Doc, Record<Lang, string>> = {
  privacy: {
    en: `<p>Mirobe is an app for organising your wardrobe, getting outfit suggestions and trying clothes on virtually. It is made by an independent developer, referred to here as "we". This page explains what information the app handles, why, and what you can do about it.</p>

<h2>What we collect</h2>
<p><b>Your account.</b> When you sign up we store your email address and your password in hashed form, so we never see the password itself. Every account also gets an internal user ID.</p>
<p><b>Your photos and wardrobe.</b> This covers the clothing photos you take or pick from your library, the full-length photo you add for try-ons, and the images and short videos the app creates from them. We also keep the details of each item, such as its category, colours and tags, and the looks you save.</p>
<p><b>Your messages to Jev.</b> What you write to the stylist is sent to our server so Jev can answer. If you use the microphone, your phone's speech recognition (Apple's on iPhone, Google's on Android) turns your voice into text and only that text reaches us.</p>
<p><b>Usage and subscriptions.</b> We count how many AI features you use each month so we can apply your plan's limits. If you subscribe, the payment is handled by Apple or Google and we never receive your card details. Through RevenueCat we only learn your subscription status and purchase history.</p>
<p><b>Technical logs.</b> Our server keeps short-lived technical logs, including IP addresses, to keep the service secure and running. They are rotated automatically and are not used to build a profile of you.</p>
<p><b>Your reports.</b> When you report an AI result in the app, we store the report (the reason, your optional note and, for a Jev reply, its text) with your account and review it, and it is deleted when you delete your account.</p>

<h2>Notifications</h2>
<p>Notifications stay off until you allow them. If you do, the app sends us your device's push token (issued by Apple, or by Google on Android) and the app's language, and we keep your notification settings with your account. We use them only for the notifications you allowed: payment notices, which our server sends through Apple's push notification service or, on Android, Google's Firebase Cloud Messaging when a payment goes through or fails. The daily 15:00 outfit reminder is scheduled on your phone itself and our server plays no part in it.</p>
<p>We delete a push token when you sign out, when you delete your account and when Apple or Google tells us the token is no longer valid. You can turn notifications off at any time in Profile, under Notifications, or in your phone's Settings.</p>
<p>Some subscription updates, such as auto-renewal being switched back on, are shown inside the app the next time you open it instead of as a notification. The app shows each one once, and we keep them for at most 30 days.</p>

<h2>What we don't do</h2>
<p>We don't show ads, we don't sell or rent your data and we don't track you across other apps or websites. The app contains no advertising or third-party analytics SDKs.</p>

<h2>Who processes your data for us</h2>
<p>Your account data and photos are stored on our server in Istanbul, Türkiye, hosted by Odeaweb. Traffic to the server passes through Cloudflare, which protects it against attacks.</p>
<p>AI features run through OpenRouter, which passes each request to the model that handles it. Google Gemini is used for tagging, the stylist chat, studio images and try-ons, ByteDance Seedance for video clips and the Jev model for outfit picks. RevenueCat verifies subscriptions for us.</p>
<p>These providers only receive what the feature you are using needs. Some of them process data outside Türkiye and the EU, mainly in the United States, and their own terms govern how long they keep request data.</p>
<p>The app asks for your permission before it sends your photos or messages to these AI providers for the first time, and sends nothing without it. You can withdraw it at any time in Profile with the AI processing switch: the AI features then stop and nothing more is sent. We record when you gave your permission. Withdrawing it doesn't delete what was already created, but you can delete those items, or your whole account, whenever you like.</p>

<h2>How long we keep it</h2>
<p>We keep your data for as long as your account exists. When you delete your account in the app (Profile, then Delete account) we remove your account, your wardrobe, your photos and everything created from them from our server. Copies in our backups are deleted within 30 days. Removing the app from your phone does not delete your account on its own.</p>

<h2>Your rights</h2>
<p>You can ask for a copy of your data, ask us to correct or delete it, and object to how we use it. Under the Turkish Personal Data Protection Law (KVKK) and the GDPR you can also complain to the relevant authority. Write to ${mail(PRIVACY_MAIL)} and we will reply within 30 days.</p>

<h2>Children</h2>
<p>Mirobe is not meant for children under 13 and we don't knowingly collect their data.</p>

<h2>Changes</h2>
<p>We will publish any changes to this policy on this page and update the date at the top.</p>

<h2>Contact</h2>
<p>Privacy questions go to ${mail(PRIVACY_MAIL)}, everything else to ${mail(SUPPORT_MAIL)}.</p>`,

    tr: `<p>Mirobe, gardırobunu düzenlemen, kombin önerisi alman ve kıyafetleri sanal olarak denemen için geliştirilmiş bir uygulamadır ve bağımsız bir geliştirici tarafından sunulur. Bu metinde "biz" dediğimizde bu geliştiriciyi kastediyoruz. Aşağıda uygulamanın hangi bilgileri neden işlediğini ve bu konuda neler yapabileceğini anlatıyoruz.</p>

<h2>Topladığımız bilgiler</h2>
<p><b>Hesap bilgilerin.</b> Kayıt olduğunda e-posta adresini ve şifreni saklarız. Şifren geri çevrilemeyecek biçimde özetlenerek tutulur, yani şifrenin kendisini hiçbir zaman görmeyiz. Her hesaba ayrıca bir kullanıcı kimliği atanır.</p>
<p><b>Fotoğrafların ve gardırobun.</b> Çektiğin ya da galeriden seçtiğin kıyafet fotoğrafları, deneme için eklediğin tam boy fotoğrafın ve uygulamanın bunlardan ürettiği görseller ile kısa videolar bu kapsamdadır. Her parçanın kategori, renk ve etiket gibi bilgilerini ve kaydettiğin kombinleri de saklarız.</p>
<p><b>Jev'e yazdıkların.</b> Stilist Jev'e yazdığın mesajlar cevap verebilmesi için sunucumuza gönderilir. Mikrofonu kullanırsan sesin telefonunun konuşma tanıma özelliğiyle (iPhone'da Apple'ın, Android'de Google'ın) metne çevrilir ve bize yalnızca bu metin ulaşır.</p>
<p><b>Kullanım ve abonelik.</b> Paketinin limitlerini uygulayabilmek için her ay yapay zeka özelliklerini kaç kez kullandığını sayarız. Abonelik satın alırsan ödemeyi Apple ya da Google alır ve kart bilgilerin bize hiçbir zaman ulaşmaz. RevenueCat üzerinden yalnızca abonelik durumunu ve satın alma geçmişini öğreniriz.</p>
<p><b>Teknik kayıtlar.</b> Sunucumuz, hizmeti güvenli ve çalışır tutmak için IP adresini de içeren kısa süreli teknik kayıtlar tutar. Bu kayıtlar otomatik olarak silinir ve hakkında profil çıkarmak için kullanılmaz.</p>
<p><b>Sorun bildirimlerin.</b> Uygulamada bir yapay zeka sonucuyla ilgili sorun bildirdiğinde bildirimini (sebebini, varsa notunu ve bir Jev cevabıysa metnini) hesabınla birlikte saklar ve inceleriz; hesabını sildiğinde o da silinir.</p>

<h2>Bildirimler</h2>
<p>Bildirimler sen izin verene kadar kapalıdır. İzin verirsen uygulama, cihazının bildirim kimliğini (Apple'ın, Android'de Google'ın verdiği push token) ve uygulamanın dilini bize gönderir; bildirim tercihlerini de hesabınla birlikte saklarız. Bunları yalnızca izin verdiğin bildirimler için kullanırız: ödemen alındığında ya da alınamadığında sunucumuzun Apple'ın bildirim servisi ya da Android'de Google'ın Firebase Cloud Messaging servisi üzerinden gönderdiği ödeme bildirimleri. Her gün 15:00'teki kombin hatırlatması doğrudan telefonunda planlanır, sunucumuz bu hatırlatmada kullanılmaz.</p>
<p>Bildirim kimliğini çıkış yaptığında, hesabını sildiğinde ya da Apple veya Google bu kimliğin artık geçerli olmadığını bildirdiğinde sileriz. Bildirimleri istediğin zaman Profil'deki Bildirimler bölümünden ya da telefonunun Ayarlar'ından kapatabilirsin.</p>
<p>Otomatik yenilemenin yeniden açılması gibi bazı abonelik güncellemeleri bildirim olarak gönderilmez, uygulamayı bir sonraki açışında uygulamanın içinde gösterilir. Uygulama her birini bir kez gösterir ve bunları en fazla 30 gün saklarız.</p>

<h2>Yapmadıklarımız</h2>
<p>Reklam göstermiyoruz, verilerini satmıyor ya da kiralamıyoruz ve seni başka uygulama ya da sitelerde takip etmiyoruz. Uygulamada reklam veya üçüncü taraf analiz SDK'sı yok.</p>

<h2>Verilerini bizim adımıza işleyenler</h2>
<p>Hesap bilgilerin ve fotoğrafların, Odeaweb tarafından barındırılan İstanbul'daki sunucumuzda saklanır. Sunucuya gelen trafik, saldırılara karşı koruma sağlayan Cloudflare üzerinden geçer.</p>
<p>Yapay zeka özellikleri, her isteği ilgili modele ileten OpenRouter üzerinden çalışır. Etiketleme, stilist sohbeti, stüdyo görselleri ve denemeler için Google Gemini, video klipler için ByteDance Seedance, kombin seçimleri için Jev modeli kullanılır. Abonelikleri ise bizim için RevenueCat doğrular.</p>
<p>Bu sağlayıcılara yalnızca kullandığın özelliğin gerektirdiği bilgi gönderilir. Bazıları verileri Türkiye ve AB dışında, ağırlıklı olarak Amerika Birleşik Devletleri'nde işler. İstek verilerini ne kadar sakladıkları kendi koşullarına bağlıdır.</p>
<p>Uygulama, fotoğraflarını ya da mesajlarını bu yapay zeka sağlayıcılarına ilk kez göndermeden önce senden izin ister ve izin vermezsen hiçbir şey göndermez. Bu izni istediğin zaman Profil'deki "Yapay zekâ ile işleme" anahtarından geri alabilirsin; o zaman yapay zeka özellikleri durur ve yeni bir şey gönderilmez. İzni ne zaman verdiğini kaydederiz. İzni geri almak daha önce üretilenleri silmez, ama bunları ya da hesabının tamamını dilediğin zaman silebilirsin.</p>

<h2>Ne kadar saklıyoruz</h2>
<p>Verilerini hesabın açık olduğu sürece saklarız. Hesabını uygulamadan sildiğinde (Profil, ardından Hesabı sil) hesabını, gardırobunu, fotoğraflarını ve bunlardan üretilen her şeyi sunucumuzdan kaldırırız. Yedeklerdeki kopyalar en geç 30 gün içinde silinir. Uygulamayı telefonundan kaldırmak tek başına hesabını silmez.</p>

<h2>Hakların</h2>
<p>Verilerinin bir kopyasını isteyebilir, düzeltilmesini ya da silinmesini talep edebilir ve nasıl kullanıldığına itiraz edebilirsin. 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) ve GDPR kapsamında ilgili denetim otoritesine başvurma hakkın da var. Taleplerin için ${mail(PRIVACY_MAIL)} adresine yazabilirsin, en geç 30 gün içinde yanıt veririz.</p>

<h2>Çocuklar</h2>
<p>Mirobe 13 yaşından küçükler için tasarlanmadı ve bu yaştaki çocuklara ait verileri bilerek toplamayız.</p>

<h2>Değişiklikler</h2>
<p>Bu politikada yapılan değişiklikleri bu sayfada yayımlar ve en üstteki tarihi güncelleriz.</p>

<h2>İletişim</h2>
<p>Gizlilikle ilgili soruların için ${mail(PRIVACY_MAIL)}, diğer her konu için ${mail(SUPPORT_MAIL)}.</p>`,
  },

  terms: {
    en: `<p>These terms apply when you use Mirobe. If you downloaded the app from the App Store, Apple's standard <a href="${APPLE_EULA}">End User License Agreement</a> also applies and these terms add to it. By using the app you agree to both.</p>

<h2>Your account</h2>
<p>The AI features need an account. Keep your password to yourself and let us know if you think someone else is using your account. You can delete your account at any time in the app.</p>

<h2>Subscriptions</h2>
<p>Mirobe Plus and Mirobe Pro are subscriptions that renew automatically every month or every year. Payment is charged to your App Store or Google Play account when you confirm the purchase. A subscription renews for the same period and price unless you cancel it at least 24 hours before the current period ends, and the renewal is charged within the 24 hours before the period ends.</p>
<p>You can manage or cancel your subscription in your App Store or Google Play account settings. Cancelling takes effect at the end of the period you have already paid for. Refunds are handled by Apple or Google under their own policies. Plan limits reset every month.</p>

<h2>What you upload</h2>
<p>Only upload photos you have the right to use, don't upload photos of other people without their permission, and don't use Mirobe for anything illegal, harmful or sexual. Your photos stay yours. You allow us to store and process them only to run the features you ask for.</p>

<h2>AI results</h2>
<p>Try-ons, studio images, videos and outfit suggestions are created by AI. They are a preview and may not show exactly how clothes fit or look in real life.</p>

<h2>Changes</h2>
<p>We may change or stop features and update these terms, and we will publish any changes on this page. We may suspend accounts that break these terms.</p>

<h2>Contact</h2>
<p>${mail(SUPPORT_MAIL)}</p>`,

    tr: `<p>Bu koşullar Mirobe'yi kullandığında geçerlidir. Uygulamayı App Store'dan indirdiysen Apple'ın standart <a href="${APPLE_EULA}">Son Kullanıcı Lisans Sözleşmesi</a> de geçerlidir ve bu koşullar onu tamamlar. Uygulamayı kullanarak ikisini de kabul etmiş olursun.</p>

<h2>Hesabın</h2>
<p>Yapay zeka özellikleri için hesap gerekir. Şifreni kimseyle paylaşma, hesabını başka birinin kullandığını düşünürsen bize haber ver. Hesabını dilediğin zaman uygulamadan silebilirsin.</p>

<h2>Abonelikler</h2>
<p>Mirobe Plus ve Mirobe Pro, her ay ya da her yıl otomatik olarak yenilenen aboneliklerdir. Ödeme, satın almayı onayladığında App Store veya Google Play hesabından alınır. Abonelik, mevcut dönem bitmeden en az 24 saat önce iptal edilmezse aynı süre ve fiyatla yenilenir ve yenileme ücreti dönemin son 24 saati içinde tahsil edilir.</p>
<p>Aboneliğini App Store veya Google Play hesap ayarlarından yönetebilir ya da iptal edebilirsin. İptal, ödemesini yaptığın dönemin sonunda geçerli olur. İadeler Apple'ın ya da Google'ın kendi politikalarına göre yapılır. Paket limitleri her ay yenilenir.</p>

<h2>Yüklediklerin</h2>
<p>Yalnızca kullanma hakkın olan fotoğrafları yükle, başkalarının fotoğraflarını izinleri olmadan yükleme ve Mirobe'yi yasa dışı, zarar verici ya da cinsel içerikli hiçbir amaçla kullanma. Fotoğrafların sana ait kalır. Onları yalnızca istediğin özellikleri çalıştırmak için saklamamıza ve işlememize izin vermiş olursun.</p>

<h2>Yapay zeka sonuçları</h2>
<p>Denemeler, stüdyo görselleri, videolar ve kombin önerileri yapay zeka ile üretilir. Bunlar bir ön izlemedir ve kıyafetlerin gerçekte nasıl durduğunu birebir göstermeyebilir.</p>

<h2>Değişiklikler</h2>
<p>Özellikleri değiştirebilir ya da kaldırabilir, bu koşulları güncelleyebiliriz. Değişiklikleri bu sayfada yayımlarız. Bu koşullara uymayan hesapları askıya alabiliriz.</p>

<h2>İletişim</h2>
<p>${mail(SUPPORT_MAIL)}</p>`,
  },

  support: {
    en: `<p>Need help with Mirobe? Write to ${mail(SUPPORT_MAIL)} and we will get back to you as soon as we can.</p>

<h2>Managing your subscription</h2>
<p>Subscriptions are handled by Apple or Google. On iPhone open Settings, tap your name and then Subscriptions. On Android open Google Play and go to Payments and subscriptions. You can also get there from the plans screen in Mirobe.</p>

<h2>Restoring a purchase</h2>
<p>Sign in to Mirobe with the account you used before and tap Restore purchases on the plans screen.</p>

<h2>Deleting your account</h2>
<p>Go to Profile and tap Delete account. This removes your account and your data from our server. If you have an active subscription, cancel it in your store account as well.</p>

<h2>Privacy</h2>
<p>You can read how we handle your data in our <a href="${BASE}/privacy?lang=en">privacy policy</a>.</p>`,

    tr: `<p>Mirobe ile ilgili yardıma mı ihtiyacın var? ${mail(SUPPORT_MAIL)} adresine yaz, en kısa sürede dönelim.</p>

<h2>Aboneliğini yönetmek</h2>
<p>Abonelikler Apple ya da Google tarafından yönetilir. iPhone'da Ayarlar'ı aç, adına dokun ve Abonelikler'e gir. Android'de Google Play'i açıp Ödemeler ve abonelikler bölümüne git. Buraya Mirobe'deki paketler ekranından da ulaşabilirsin.</p>

<h2>Satın alımı geri yüklemek</h2>
<p>Daha önce kullandığın hesapla Mirobe'ye giriş yap ve paketler ekranında Satın alımları geri yükle'ye dokun.</p>

<h2>Hesabını silmek</h2>
<p>Profil'e git ve Hesabı sil'e dokun. Bu işlem hesabını ve verilerini sunucumuzdan kaldırır. Aktif bir aboneliğin varsa onu mağaza hesabından ayrıca iptal et.</p>

<h2>Gizlilik</h2>
<p>Verilerini nasıl işlediğimizi <a href="${BASE}/privacy?lang=tr">gizlilik politikamızda</a> okuyabilirsin.</p>`,
  },
  'delete-account': {
    en: `<p>Mirobe (by Orbexa Studio) lets you delete your account and its data at any time, from the app or by email.</p>

<h2>In the app</h2>
<ol>
<li>Open Mirobe and sign in.</li>
<li>Go to Profile and tap Delete account.</li>
<li>Enter your password to confirm.</li>
</ol>
<p>Your account is deleted immediately.</p>

<h2>Without the app</h2>
<p>If you no longer have the app, write to ${mail(PRIVACY_MAIL)} from the email address of your Mirobe account with the subject "Delete my account". We confirm by email and delete the account within 30 days.</p>

<h2>What is deleted</h2>
<p>Your account (email address, hashed password, user ID), your wardrobe, your photos, the images and videos created from them, your saved looks, your usage counts, your notification settings and push tokens, your in-app notices, and your reports of AI results.</p>

<h2>What is kept, and for how long</h2>
<p>Copies in our backups are deleted within 30 days. Short-lived technical server logs are rotated automatically. Purchase records kept by Apple, Google and RevenueCat follow their own retention rules, and an active subscription is not cancelled by deleting the account: cancel it in the App Store or Google Play as well.</p>

<p>More in our <a href="${BASE}/privacy?lang=en">privacy policy</a>.</p>`,

    tr: `<p>Mirobe (Orbexa Studio) hesabını ve verilerini istediğin zaman uygulamadan ya da e-postayla silebilirsin.</p>

<h2>Uygulamadan</h2>
<ol>
<li>Mirobe'yi aç ve giriş yap.</li>
<li>Profil'e git ve Hesabı sil'e dokun.</li>
<li>Onaylamak için şifreni gir.</li>
</ol>
<p>Hesabın hemen silinir.</p>

<h2>Uygulama olmadan</h2>
<p>Uygulama artık elinde değilse Mirobe hesabının e-posta adresinden ${mail(PRIVACY_MAIL)} adresine "Hesabımı sil" konulu bir e-posta gönder. E-postayla onaylar ve hesabını en geç 30 gün içinde sileriz.</p>

<h2>Neler silinir</h2>
<p>Hesabın (e-posta adresin, şifrenin özeti, kullanıcı kimliğin), gardırobun, fotoğrafların, bunlardan üretilen görseller ve videolar, kaydettiğin kombinler, kullanım sayaçların, bildirim tercihlerin ve bildirim kimliklerin, uygulama içi duyuruların ve yapay zeka sonuçları için gönderdiğin sorun bildirimlerin.</p>

<h2>Neler, ne kadar süre kalır</h2>
<p>Yedeklerdeki kopyalar en geç 30 gün içinde silinir. Kısa süreli teknik sunucu kayıtları otomatik olarak döndürülür. Apple, Google ve RevenueCat'in tuttuğu satın alma kayıtları onların kendi saklama kurallarına tabidir; hesabı silmek aktif bir aboneliği iptal etmez, onu App Store'dan ya da Google Play'den ayrıca iptal et.</p>

<p>Ayrıntılar <a href="${BASE}/privacy?lang=tr">gizlilik politikamızda</a>.</p>`,
  },
};

function render(doc: Doc, lang: Lang) {
  const other: Lang = lang === 'tr' ? 'en' : 'tr';
  const switchLabel = lang === 'tr' ? 'English' : 'Türkçe';
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mirobe · ${TITLES[doc][lang]}</title>
<style>
  body { font: 16px/1.65 -apple-system, system-ui, sans-serif; max-width: 720px; margin: 0 auto; padding: 24px 16px 64px; color: #1A1918; background: #FBF9F5; }
  h1 { font-size: 28px; margin-bottom: 4px; } h2 { font-size: 19px; margin-top: 32px; }
  a { color: #8A6A2F; } .muted { color: #6F6A63; font-size: 14px; } nav { text-align: right; font-size: 14px; }
</style>
</head>
<body>
<nav><a href="${BASE}/${doc}?lang=${other}">${switchLabel}</a></nav>
<h1>${TITLES[doc][lang]}</h1>
<p class="muted">${UPDATED[lang]}</p>
${BODIES[doc][lang]}
</body>
</html>`;
}

function pickLang(req: express.Request): Lang {
  const q = String(req.query.lang ?? '').toLowerCase();
  if (q === 'tr' || q === 'en') return q;
  return /^tr\b/i.test(req.get('accept-language') ?? '') ? 'tr' : 'en';
}

export function legalRoutes() {
  const router = express.Router();
  const send = (doc: Doc) => (req: express.Request, res: express.Response) => {
    res.set({ 'Cache-Control': 'public, max-age=3600', Vary: 'Accept-Language' }).type('html').send(render(doc, pickLang(req)));
  };
  router.get(`${BASE}/privacy`, send('privacy'));
  router.get(`${BASE}/terms`, send('terms'));
  router.get(`${BASE}/support`, send('support'));
  // The account deletion page the Google Play listing links to (Data safety → delete account URL).
  router.get(`${BASE}/delete-account`, send('delete-account'));
  return router;
}
