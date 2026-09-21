import React, { useState } from 'react';
import {
  ChevronRight,
  HelpCircle,
  Palette,
  Sliders,
  Sparkles,
  Shield,
  Bell,
  Camera,
  Globe,
  Check,
  X,
  Lock,
  ChevronDown,
  RotateCcw,
  MessageSquare,
  Eye,
  SlidersHorizontal,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { triggerHaptic } from '../../services/haptics';
import { MIROBE_PLANS, PLAN_COPY } from '../../services/entitlements';
import { hasRevenueCatConfiguration, purchaseSubscription } from '../../services/billingService';

export const ProfileScreen: React.FC = () => {
  const {
    garments,
    looks,
    mirrorProfile,
    language,
    setLanguage,
    setFlow,
    t,
    planId,
    planLabel,
    photoTokensRemaining,
    monthlyAiSecondsRemaining,
    dailyJevDecisions,
    dailyJevLimit,
  } = useApp();

  const savedCount = looks.filter((l) => l.saved).length;

  // Active sub-page modal: null | 'mirror' | 'style' | 'body' | 'notifications' | 'privacy' | 'help' | 'language'
  const [activeModal, setActiveModal] = useState<
    null | 'plan' | 'mirror' | 'style' | 'body' | 'notifications' | 'privacy' | 'help' | 'language'
  >(null);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // Sub-page state: Style Preferences
  const [selectedStyles, setSelectedStyles] = useState<string[]>([
    'minimalist',
    'streetwear',
    'casual',
  ]);

  // Sub-page state: Body Profile
  const [bodyHeight, setBodyHeight] = useState<number>(178);
  const [bodyWeight, setBodyWeight] = useState<number>(74);
  const [topSize, setTopSize] = useState<string>('M / L (Oversize)');
  const [bottomSize, setBottomSize] = useState<string>('31 / 32');
  const [shoeSize, setShoeSize] = useState<string>('42 EU');
  const [fitPref, setFitPref] = useState<string>('Oversize / Relaxed');

  // Sub-page state: Notifications
  const [notifDailyLook, setNotifDailyLook] = useState<boolean>(true);
  const [notifWeather, setNotifWeather] = useState<boolean>(true);
  const [notifStylist, setNotifStylist] = useState<boolean>(true);
  const [notifWardrobe, setNotifWardrobe] = useState<boolean>(false);

  // Sub-page state: Mirror Calibration
  const [camSensitivity, setCamSensitivity] = useState<number>(90);

  // Sub-page state: FAQ Accordions
  const [expandedFaq, setExpandedFaq] = useState<number | null>(1);

  const settingsItems = [
    {
      id: 'ai-plan',
      label: 'AI paketi & tokenlar',
      icon: <Sparkles className="w-4 h-4 text-[#A06A22]" />,
      sub: `${planLabel} · ${photoTokensRemaining} fotoğraf tokenı kaldı`,
      action: () => {
        triggerHaptic('light');
        setActiveModal('plan');
      },
    },
    {
      id: 'mirror-profile',
      label: t.profile.mirrorProfile.label,
      icon: <Camera className="w-4 h-4 text-[#8C6B38]" />,
      sub: `${mirrorProfile.height || '178 cm'} • ${t.profile.mirrorProfile.sub}`,
      action: () => {
        triggerHaptic('light');
        setActiveModal('mirror');
      },
    },
    {
      id: 'style-prefs',
      label: t.profile.stylePrefs.label,
      icon: <Palette className="w-4 h-4 text-[#4A6B82]" />,
      sub: t.profile.stylePrefs.sub,
      action: () => {
        triggerHaptic('light');
        setActiveModal('style');
      },
    },
    {
      id: 'body-profile',
      label: t.profile.bodyProfile.label,
      icon: <Sliders className="w-4 h-4 text-[#5B7A58]" />,
      sub: `${bodyHeight} cm • Üst: ${topSize} • Alt: ${bottomSize}`,
      action: () => {
        triggerHaptic('light');
        setActiveModal('body');
      },
    },
    {
      id: 'notifications',
      label: t.profile.notifications.label,
      icon: <Bell className="w-4 h-4 text-[#8E5B75]" />,
      sub: t.profile.notifications.sub,
      action: () => {
        triggerHaptic('light');
        setActiveModal('notifications');
      },
    },
    {
      id: 'language',
      label: t.profile.languageSetting.label,
      icon: <Globe className="w-4 h-4 text-[#2E6B6B]" />,
      sub: language === 'tr' ? 'Türkçe (Etkin)' : 'English (Active)',
      action: () => {
        triggerHaptic('light');
        setActiveModal('language');
      },
    },
    {
      id: 'privacy',
      label: t.profile.privacy.label,
      icon: <Shield className="w-4 h-4 text-[#436452]" />,
      sub: t.profile.privacy.sub,
      action: () => {
        triggerHaptic('light');
        setActiveModal('privacy');
      },
    },
    {
      id: 'help',
      label: t.profile.help.label,
      icon: <HelpCircle className="w-4 h-4 text-[#6A665E]" />,
      sub: t.profile.help.sub,
      action: () => {
        triggerHaptic('light');
        setActiveModal('help');
      },
    },
  ];

  return (
    <div
      id="screen-profile-you"
      className="flex-1 w-full bg-[#FBF9F5] px-5 py-3 flex flex-col space-y-6 overflow-y-auto no-scrollbar relative"
    >
      {/* Toast */}
      {toastMessage && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 bg-[#1A1918] text-white px-4 py-2 rounded-full text-xs font-medium shadow-xl flex items-center space-x-1.5 animate-in slide-in-from-top-2">
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header */}
      <div className="pt-1 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl text-[#1A1918] font-normal tracking-tight">
            {t.profile.title}
          </h1>
          <p className="text-xs text-[#78746D] mt-0.5">{t.profile.subtitle}</p>
        </div>

        {/* Quick Language Toggle Pill */}
        <button
          type="button"
          onClick={() => {
            triggerHaptic('selection');
            const next = language === 'tr' ? 'en' : 'tr';
            setLanguage(next);
            showToast(next === 'tr' ? 'Dil: Türkçe' : 'Language: English');
          }}
          className="px-2.5 py-1 rounded-full bg-[#EFECE6] border border-[#E8E4DC] text-xs font-medium text-[#1A1918] flex items-center space-x-1 hover:bg-[#E8E4DC] transition-colors cursor-pointer"
        >
          <Globe className="w-3.5 h-3.5 text-[#78746D]" />
          <span className="uppercase">{language}</span>
        </button>
      </div>

      {/* User Card: Eren Baydar Profile Portrait & Stats */}
      <div className="flex flex-col items-center text-center p-5 bg-[#EFECE6] rounded-3xl border border-[#E8E4DC] relative shadow-xs">
        <div className="relative mb-3">
          <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-white shadow-md">
            <img
              src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80"
              alt={mirrorProfile.name}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center text-white" title="Canlı Ayna Aktif">
            <Sparkles className="w-3 h-3" />
          </div>
        </div>

        <h2 className="text-base font-semibold text-[#1A1918]">{mirrorProfile.name}</h2>
        <p className="text-xs text-[#78746D] font-serif italic mt-0.5">
          {language === 'tr'
            ? 'Akıllı Gardrop & Kişisel Stil Aynası'
            : 'Personal Digital Wardrobe & Mirror'}
        </p>

        {/* Minimal Statistics Grid */}
        <div className="grid grid-cols-3 gap-2 w-full mt-4 pt-3 border-t border-[#E8E4DC]">
          <div className="flex flex-col items-center">
            <span className="font-serif text-xl text-[#1A1918]">{garments.length}</span>
            <span className="text-[10px] text-[#78746D] uppercase tracking-wider">
              {t.profile.pieces}
            </span>
          </div>
          <div className="flex flex-col items-center">
            <span className="font-serif text-xl text-[#1A1918]">{looks.length}</span>
            <span className="text-[10px] text-[#78746D] uppercase tracking-wider">
              {t.profile.looks}
            </span>
          </div>
          <div className="flex flex-col items-center">
            <span className="font-serif text-xl text-[#1A1918]">{savedCount}</span>
            <span className="text-[10px] text-[#78746D] uppercase tracking-wider">
              {t.profile.saved}
            </span>
          </div>
        </div>
      </div>

      {activeModal === 'plan' && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-xs sm:items-center sm:p-4">
          <div className="w-full max-w-md space-y-4 rounded-t-3xl border border-[#E8E4DC] bg-[#FBF9F5] p-5 shadow-2xl sm:rounded-3xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#A06A22]">Mirobe AI</p>
                <h3 className="mt-1 text-lg font-semibold text-[#1A1918]">Paketini seç</h3>
              </div>
              <button type="button" onClick={() => setActiveModal(null)} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#EFECE6] text-[#78746D]"><X className="h-4 w-4" /></button>
            </div>

            <div className="rounded-2xl border border-[#E8E4DC] bg-[#EFECE6] p-3 text-xs text-[#5F5A52]">
              <div className="flex items-center justify-between"><span>Aktif paket</span><strong className="text-[#1A1918]">{planLabel}</strong></div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[10px]">
                <span><b className="block text-sm text-[#1A1918]">{photoTokensRemaining}</b>foto tokenı</span>
                <span><b className="block text-sm text-[#1A1918]">{Math.max(0, dailyJevLimit - dailyJevDecisions)}</b>Jev kombini</span>
                <span><b className="block text-sm text-[#1A1918]">{monthlyAiSecondsRemaining}s</b>video</span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex rounded-full border border-[#E8E4DC] bg-white p-1 text-[10px]">
                <button type="button" onClick={() => setBillingPeriod('monthly')} className={`flex-1 rounded-full py-2 ${billingPeriod === 'monthly' ? 'bg-[#1A1918] text-white' : 'text-[#78746D]'}`}>Aylık</button>
                <button type="button" onClick={() => setBillingPeriod('annual')} className={`flex-1 rounded-full py-2 ${billingPeriod === 'annual' ? 'bg-[#1A1918] text-white' : 'text-[#78746D]'}`}>Yıllık · %20 avantaj</button>
              </div>
              {(Object.entries(MIROBE_PLANS) as [keyof typeof MIROBE_PLANS, (typeof MIROBE_PLANS)[keyof typeof MIROBE_PLANS]][]).map(([id, plan]) => (
                <button
                  key={id}
                  type="button"
                  onClick={async () => {
                    if (id !== 'free' && hasRevenueCatConfiguration()) {
                      const purchased = await purchaseSubscription(id, billingPeriod);
                      if (!purchased) {
                        showToast('Mağaza satın alımı tamamlanmadı.');
                        return;
                      }
                    }
                    window.localStorage.setItem('mirobe_plan', id);
                    setActiveModal(null);
                    window.location.reload();
                  }}
                  className={`w-full rounded-2xl border p-3 text-left transition ${id === planId ? 'border-[#1A1918] bg-[#1A1918] text-white' : 'border-[#E8E4DC] bg-white text-[#1A1918]'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{plan.label}</span>
                    <span className="font-mono text-xs">{plan.priceUsd === 0 ? 'Ücretsiz' : `$${(billingPeriod === 'monthly' ? plan.priceUsd : plan.annualPriceUsd).toFixed(2)} / ${billingPeriod === 'monthly' ? 'ay' : 'yıl'}`}</span>
                  </div>
                  <p className={`mt-1 text-[10px] ${id === planId ? 'text-white/70' : 'text-[#78746D]'}`}>{PLAN_COPY[id]}</p>
                </button>
              ))}
            </div>
            <p className="text-center text-[10px] text-[#9B958B]">Demo ortamında paket seçimi cihazda saklanır. Mağaza satın alımı bağlandığında bu ekran RevenueCat entitlement’ıyla güncellenecek.</p>
          </div>
        </div>
      )}

      {/* Settings List */}
      <div className="space-y-2 pb-6">
        <p className="text-[10px] uppercase tracking-wider text-[#78746D] font-medium px-1">
          {t.profile.sectionsTitle}
        </p>
        <div className="bg-[#EFECE6] rounded-2xl border border-[#E8E4DC] overflow-hidden divide-y divide-[#E8E4DC]">
          {settingsItems.map((item) => (
            <button
              key={item.id}
              type="button"
              id={`btn-profile-${item.id}`}
              onClick={item.action}
              className="w-full p-3.5 flex items-center justify-between hover:bg-[#E8E4DC]/60 transition-colors text-left cursor-pointer active:scale-[0.99]"
            >
              <div className="flex items-center space-x-3 text-[#1A1918]">
                <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-2xs">
                  {item.icon}
                </div>
                <div>
                  <p className="text-xs font-medium text-[#1A1918]">{item.label}</p>
                  <p className="text-[10px] text-[#78746D]">{item.sub}</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-[#A39E93]" />
            </button>
          ))}
        </div>

        {/* Brand Tagline Footer */}
        <div className="text-center pt-4 pb-2 space-y-1">
          <p className="font-serif text-sm text-[#1A1918] font-normal tracking-wide">mirobe</p>
          <p className="text-[10px] text-[#78746D]">
            {language === 'tr' ? 'Sürüm 2.4 • Gizli & Güvenli Ayna' : 'Version 2.4 • Private Neural Vault'}
          </p>
        </div>
      </div>

      {/* ============================================================ */}
      {/* SUB-PAGE MODAL 1: MIRROR CALIBRATION PROFILE                 */}
      {/* ============================================================ */}
      {activeModal === 'mirror' && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-[#FBF9F5] rounded-t-3xl sm:rounded-3xl p-5 border border-[#E8E4DC] shadow-2xl max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#E8E4DC]">
              <div className="flex items-center space-x-2">
                <Camera className="w-4 h-4 text-amber-700" />
                <h3 className="text-sm font-semibold text-[#1A1918]">
                  {t.profile.mirrorProfile.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="w-7 h-7 rounded-full bg-[#EFECE6] flex items-center justify-center text-[#78746D] hover:text-[#1A1918]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#78746D] leading-relaxed">
              {t.profile.mirrorProfile.desc}
            </p>

            {/* Current Calibration Status */}
            <div className="bg-[#EFECE6] p-4 rounded-2xl border border-[#E8E4DC] space-y-3">
              <div className="flex justify-between items-center text-xs">
                <span className="text-[#78746D]">{t.profile.mirrorProfile.height}:</span>
                <span className="font-semibold text-[#1A1918]">{mirrorProfile.height || '178 cm'}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-[#78746D]">{t.profile.mirrorProfile.proportions}:</span>
                <span className="font-semibold text-[#1A1918]">
                  {mirrorProfile.bodyType || 'Atletik / Orantılı'}
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#78746D]">{t.profile.mirrorProfile.cameraSensitivity}:</span>
                  <span className="font-mono text-xs text-[#1A1918]">%{camSensitivity}</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="100"
                  value={camSensitivity}
                  onChange={(e) => setCamSensitivity(Number(e.target.value))}
                  className="w-full accent-[#1A1918]"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                triggerHaptic('medium');
                setActiveModal(null);
                setFlow('create-mirror');
              }}
              className="w-full py-2.5 rounded-full bg-[#1A1918] text-white text-xs font-semibold hover:bg-[#333] transition-colors cursor-pointer flex items-center justify-center space-x-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{t.profile.mirrorProfile.recalibrateBtn}</span>
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* SUB-PAGE MODAL 2: STYLE PREFERENCES                          */}
      {/* ============================================================ */}
      {activeModal === 'style' && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-[#FBF9F5] rounded-t-3xl sm:rounded-3xl p-5 border border-[#E8E4DC] shadow-2xl max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#E8E4DC]">
              <div className="flex items-center space-x-2">
                <Palette className="w-4 h-4 text-blue-700" />
                <h3 className="text-sm font-semibold text-[#1A1918]">
                  {t.profile.stylePrefs.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="w-7 h-7 rounded-full bg-[#EFECE6] flex items-center justify-center text-[#78746D] hover:text-[#1A1918]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#78746D] leading-relaxed">
              {t.profile.stylePrefs.desc}
            </p>

            {/* Interactive Style Chips */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'minimalist', label: t.profile.stylePrefs.minimalist, icon: '🌿' },
                { id: 'streetwear', label: t.profile.stylePrefs.streetwear, icon: '🧢' },
                { id: 'parisian', label: t.profile.stylePrefs.parisian, icon: '🥐' },
                { id: 'oldMoney', label: t.profile.stylePrefs.oldMoney, icon: '🏛️' },
                { id: 'tailored', label: t.profile.stylePrefs.tailored, icon: '👔' },
                { id: 'pubCasual', label: language === 'tr' ? 'Pub & Gece Dışarı' : 'Pub & Night Out', icon: '🍻' },
              ].map((style) => {
                const isSelected = selectedStyles.includes(style.id);
                return (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => {
                      triggerHaptic('selection');
                      setSelectedStyles((prev) =>
                        prev.includes(style.id)
                          ? prev.filter((s) => s !== style.id)
                          : [...prev, style.id]
                      );
                    }}
                    className={`p-3 rounded-2xl border text-left flex items-center space-x-2.5 transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#1A1918] text-white border-[#1A1918] shadow-sm'
                        : 'bg-[#EFECE6] text-[#1A1918] border-[#E8E4DC] hover:bg-[#E8E4DC]'
                    }`}
                  >
                    <span className="text-base">{style.icon}</span>
                    <span className="text-xs font-medium">{style.label}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => {
                triggerHaptic('success');
                setActiveModal(null);
                showToast(language === 'tr' ? 'Stil tercihleri kaydedildi' : 'Style preferences saved');
              }}
              className="w-full py-2.5 rounded-full bg-[#1A1918] text-white text-xs font-semibold hover:bg-[#333] transition-colors cursor-pointer"
            >
              {t.profile.stylePrefs.saveBtn}
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* SUB-PAGE MODAL 3: BODY SIZES & PROFILE                       */}
      {/* ============================================================ */}
      {activeModal === 'body' && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-[#FBF9F5] rounded-t-3xl sm:rounded-3xl p-5 border border-[#E8E4DC] shadow-2xl max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#E8E4DC]">
              <div className="flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-emerald-700" />
                <h3 className="text-sm font-semibold text-[#1A1918]">
                  {t.profile.bodyProfile.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="w-7 h-7 rounded-full bg-[#EFECE6] flex items-center justify-center text-[#78746D] hover:text-[#1A1918]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#78746D] leading-relaxed">
              {t.profile.bodyProfile.desc}
            </p>

            <div className="space-y-3 bg-[#EFECE6] p-4 rounded-2xl border border-[#E8E4DC]">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-[#78746D] font-medium block mb-1">
                    {t.profile.bodyProfile.heightLabel}
                  </label>
                  <input
                    type="number"
                    value={bodyHeight}
                    onChange={(e) => setBodyHeight(Number(e.target.value))}
                    className="w-full bg-white px-3 py-1.5 rounded-xl border border-[#E8E4DC] text-xs font-semibold text-[#1A1918]"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#78746D] font-medium block mb-1">
                    {t.profile.bodyProfile.weightLabel}
                  </label>
                  <input
                    type="number"
                    value={bodyWeight}
                    onChange={(e) => setBodyWeight(Number(e.target.value))}
                    className="w-full bg-white px-3 py-1.5 rounded-xl border border-[#E8E4DC] text-xs font-semibold text-[#1A1918]"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] text-[#78746D] font-medium block mb-1">
                  {t.profile.bodyProfile.topSizeLabel}
                </label>
                <input
                  type="text"
                  value={topSize}
                  onChange={(e) => setTopSize(e.target.value)}
                  className="w-full bg-white px-3 py-1.5 rounded-xl border border-[#E8E4DC] text-xs font-medium text-[#1A1918]"
                />
              </div>

              <div>
                <label className="text-[11px] text-[#78746D] font-medium block mb-1">
                  {t.profile.bodyProfile.bottomSizeLabel}
                </label>
                <input
                  type="text"
                  value={bottomSize}
                  onChange={(e) => setBottomSize(e.target.value)}
                  className="w-full bg-white px-3 py-1.5 rounded-xl border border-[#E8E4DC] text-xs font-medium text-[#1A1918]"
                />
              </div>

              <div>
                <label className="text-[11px] text-[#78746D] font-medium block mb-1">
                  {t.profile.bodyProfile.shoeSizeLabel}
                </label>
                <input
                  type="text"
                  value={shoeSize}
                  onChange={(e) => setShoeSize(e.target.value)}
                  className="w-full bg-white px-3 py-1.5 rounded-xl border border-[#E8E4DC] text-xs font-medium text-[#1A1918]"
                />
              </div>

              <div>
                <label className="text-[11px] text-[#78746D] font-medium block mb-1">
                  {t.profile.bodyProfile.fitPreferenceLabel}
                </label>
                <select
                  value={fitPref}
                  onChange={(e) => setFitPref(e.target.value)}
                  className="w-full bg-white px-3 py-1.5 rounded-xl border border-[#E8E4DC] text-xs font-medium text-[#1A1918]"
                >
                  <option value="Oversize / Relaxed">Oversize / Salaş & Rahat</option>
                  <option value="Regular Fit">Normal Kalıp (Regular Fit)</option>
                  <option value="Slim Fit">Dar Kalıp (Slim Fit)</option>
                  <option value="Tailored">Özel Dikim (Tailored)</option>
                </select>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                triggerHaptic('success');
                setActiveModal(null);
                showToast(language === 'tr' ? 'Beden ölçüleri güncellendi' : 'Body measurements updated');
              }}
              className="w-full py-2.5 rounded-full bg-[#1A1918] text-white text-xs font-semibold hover:bg-[#333] transition-colors cursor-pointer"
            >
              {t.profile.bodyProfile.saveBtn}
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* SUB-PAGE MODAL 4: NOTIFICATIONS                              */}
      {/* ============================================================ */}
      {activeModal === 'notifications' && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-[#FBF9F5] rounded-t-3xl sm:rounded-3xl p-5 border border-[#E8E4DC] shadow-2xl max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#E8E4DC]">
              <div className="flex items-center space-x-2">
                <Bell className="w-4 h-4 text-purple-700" />
                <h3 className="text-sm font-semibold text-[#1A1918]">
                  {t.profile.notifications.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="w-7 h-7 rounded-full bg-[#EFECE6] flex items-center justify-center text-[#78746D] hover:text-[#1A1918]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#78746D] leading-relaxed">
              {t.profile.notifications.desc}
            </p>

            <div className="bg-[#EFECE6] rounded-2xl border border-[#E8E4DC] divide-y divide-[#E8E4DC]">
              {[
                {
                  label: t.profile.notifications.dailyLook,
                  val: notifDailyLook,
                  set: setNotifDailyLook,
                },
                {
                  label: t.profile.notifications.weatherAlert,
                  val: notifWeather,
                  set: setNotifWeather,
                },
                {
                  label: t.profile.notifications.stylistMessages,
                  val: notifStylist,
                  set: setNotifStylist,
                },
                {
                  label: t.profile.notifications.wardrobeClean,
                  val: notifWardrobe,
                  set: setNotifWardrobe,
                },
              ].map((item, idx) => (
                <div key={idx} className="p-3.5 flex items-center justify-between">
                  <span className="text-xs text-[#1A1918] font-medium pr-2">{item.label}</span>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic('selection');
                      item.set(!item.val);
                    }}
                    className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                      item.val ? 'bg-[#1A1918]' : 'bg-[#D1CCC4]'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${
                        item.val ? 'left-6' : 'left-1'
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                triggerHaptic('success');
                setActiveModal(null);
                showToast(language === 'tr' ? 'Bildirim ayarları güncellendi' : 'Notification preferences saved');
              }}
              className="w-full py-2.5 rounded-full bg-[#1A1918] text-white text-xs font-semibold hover:bg-[#333] transition-colors cursor-pointer"
            >
              {t.profile.notifications.saveBtn}
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* SUB-PAGE MODAL 5: LANGUAGE SELECTION                         */}
      {/* ============================================================ */}
      {activeModal === 'language' && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-[#FBF9F5] rounded-t-3xl sm:rounded-3xl p-5 border border-[#E8E4DC] shadow-2xl max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#E8E4DC]">
              <div className="flex items-center space-x-2">
                <Globe className="w-4 h-4 text-teal-700" />
                <h3 className="text-sm font-semibold text-[#1A1918]">
                  {t.profile.languageSetting.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="w-7 h-7 rounded-full bg-[#EFECE6] flex items-center justify-center text-[#78746D] hover:text-[#1A1918]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('selection');
                  setLanguage('tr');
                  setActiveModal(null);
                  showToast('Dil Türkçe olarak ayarlandı');
                }}
                className={`w-full p-4 rounded-2xl border flex items-center justify-between transition-all cursor-pointer ${
                  language === 'tr'
                    ? 'bg-[#1A1918] text-white border-[#1A1918]'
                    : 'bg-[#EFECE6] text-[#1A1918] border-[#E8E4DC]'
                }`}
              >
                <div className="text-left">
                  <p className="text-xs font-semibold">Türkçe</p>
                  <p className="text-[10px] opacity-70">Varsayılan dil</p>
                </div>
                {language === 'tr' && <Check className="w-4 h-4 text-emerald-400" />}
              </button>

              <button
                type="button"
                onClick={() => {
                  triggerHaptic('selection');
                  setLanguage('en');
                  setActiveModal(null);
                  showToast('Language set to English');
                }}
                className={`w-full p-4 rounded-2xl border flex items-center justify-between transition-all cursor-pointer ${
                  language === 'en'
                    ? 'bg-[#1A1918] text-white border-[#1A1918]'
                    : 'bg-[#EFECE6] text-[#1A1918] border-[#E8E4DC]'
                }`}
              >
                <div className="text-left">
                  <p className="text-xs font-semibold">English</p>
                  <p className="text-[10px] opacity-70">International</p>
                </div>
                {language === 'en' && <Check className="w-4 h-4 text-emerald-400" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* SUB-PAGE MODAL 6: PRIVACY & DATA                             */}
      {/* ============================================================ */}
      {activeModal === 'privacy' && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-[#FBF9F5] rounded-t-3xl sm:rounded-3xl p-5 border border-[#E8E4DC] shadow-2xl max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#E8E4DC]">
              <div className="flex items-center space-x-2">
                <Shield className="w-4 h-4 text-emerald-700" />
                <h3 className="text-sm font-semibold text-[#1A1918]">
                  {t.profile.privacy.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="w-7 h-7 rounded-full bg-[#EFECE6] flex items-center justify-center text-[#78746D] hover:text-[#1A1918]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#78746D] leading-relaxed">
              {t.profile.privacy.desc}
            </p>

            <div className="bg-[#EFECE6] p-4 rounded-2xl border border-[#E8E4DC] space-y-3">
              <div className="flex items-center space-x-2 text-xs text-emerald-800 font-medium">
                <Lock className="w-4 h-4" />
                <span>{t.profile.privacy.dataEncrypted}</span>
              </div>
              <p className="text-[11px] text-[#78746D]">
                {t.profile.privacy.localProcessing}
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                triggerHaptic('light');
                setActiveModal(null);
                showToast(language === 'tr' ? 'Gizlilik ayarları onaylandı' : 'Privacy settings confirmed');
              }}
              className="w-full py-2.5 rounded-full bg-[#1A1918] text-white text-xs font-semibold hover:bg-[#333] transition-colors cursor-pointer"
            >
              Tamam
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* SUB-PAGE MODAL 7: HELP & FAQ                                 */}
      {/* ============================================================ */}
      {activeModal === 'help' && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-[#FBF9F5] rounded-t-3xl sm:rounded-3xl p-5 border border-[#E8E4DC] shadow-2xl max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#E8E4DC]">
              <div className="flex items-center space-x-2">
                <HelpCircle className="w-4 h-4 text-zinc-700" />
                <h3 className="text-sm font-semibold text-[#1A1918]">
                  {t.profile.help.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="w-7 h-7 rounded-full bg-[#EFECE6] flex items-center justify-center text-[#78746D] hover:text-[#1A1918]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              {[
                {
                  id: 1,
                  q: t.profile.help.faq1Q,
                  a: t.profile.help.faq1A,
                },
                {
                  id: 2,
                  q: t.profile.help.faq2Q,
                  a: t.profile.help.faq2A,
                },
                {
                  id: 3,
                  q: t.profile.help.faq3Q,
                  a: t.profile.help.faq3A,
                },
              ].map((faq) => {
                const isOpen = expandedFaq === faq.id;
                return (
                  <div
                    key={faq.id}
                    className="bg-[#EFECE6] rounded-2xl border border-[#E8E4DC] overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic('light');
                        setExpandedFaq(isOpen ? null : faq.id);
                      }}
                      className="w-full p-3.5 flex items-center justify-between text-left cursor-pointer"
                    >
                      <span className="text-xs font-semibold text-[#1A1918]">{faq.q}</span>
                      <ChevronDown
                        className={`w-4 h-4 text-[#78746D] transition-transform ${
                          isOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    {isOpen && (
                      <div className="px-3.5 pb-3.5 text-xs text-[#78746D] leading-relaxed border-t border-[#E8E4DC]/60 pt-2">
                        {faq.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => {
                triggerHaptic('medium');
                setActiveModal(null);
                showToast(language === 'tr' ? 'Jev Stil Ekibine bağlandı' : 'Connected to Jev Stylist Team');
              }}
              className="w-full py-2.5 rounded-full bg-[#1A1918] text-white text-xs font-semibold hover:bg-[#333] transition-colors cursor-pointer flex items-center justify-center space-x-1.5"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>{t.profile.help.contactConcierge}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
