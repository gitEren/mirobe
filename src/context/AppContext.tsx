import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../services/api';
import { triggerHaptic } from '../services/haptics';
import { Language, translations } from '../services/i18n';
import { SCAN_SAMPLE_DETECTED, TRYON_RENDERS } from '../services/mockData';
import { tryonService } from '../services/tryonService';
import { getLocalEntitlement, MIROBE_LIMITS, MIROBE_PLANS } from '../services/entitlements';
import { configureRevenueCat, getRevenueCatPlan } from '../services/billingService';
import {
  FlowType,
  Garment,
  LiveMirrorState,
  Look,
  MirrorProfile,
  StylistMessage,
  TabType,
} from '../types';

export type DeviceType = 'ios' | 'android' | 'fullscreen';

interface AppContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: typeof translations.tr;
  deviceType: DeviceType;
  setDeviceType: (device: DeviceType) => void;
  tab: TabType;
  setTab: (tab: TabType) => void;
  flow: FlowType;
  setFlow: (flow: FlowType) => void;
  garments: Garment[];
  looks: Look[];
  mirrorProfile: MirrorProfile;
  activeWearingId: string;
  activeGarmentIds: string[];
  activeMirrorRender: {
    fullUrl: string;
    previewUrl: string;
    title: string;
    isTransitioning: boolean;
  };
  selectedGarment: Garment | null;
  setSelectedGarment: (garment: Garment | null) => void;
  selectedLook: Look | null;
  setSelectedLook: (look: Look | null) => void;
  lastCapturedScanPhoto: string | null;
  setLastCapturedScanPhoto: (url: string | null) => void;
  pendingDetectedGarments: Omit<Garment, 'id' | 'userId' | 'createdAt'>[];
  setPendingDetectedGarments: React.Dispatch<React.SetStateAction<Omit<Garment, 'id' | 'userId' | 'createdAt'>[]>>;
  stylistMessages: StylistMessage[];
  compareLooks: Look[];
  isQuickChangeOpen: boolean;
  setIsQuickChangeOpen: (open: boolean) => void;
  isCompareOpen: boolean;
  setIsCompareOpen: (open: boolean) => void;
  liveMirror: LiveMirrorState;
  setLiveMirror: (state: Partial<LiveMirrorState>) => void;
  dailyJevDecisions: number;
  dailyJevLimit: number;
  monthlyAiSecondsUsed: number;
  monthlyAiSecondsLimit: number;
  monthlyAiSecondsRemaining: number;
  planId: 'free' | 'premium' | 'pro';
  planLabel: string;
  photoTokensUsed: number;
  photoTokensLimit: number;
  photoTokensRemaining: number;
  reservePhotoTokens: (tokens: number) => boolean;
  refundPhotoTokens: (tokens: number) => void;
  registerJevDecision: () => boolean;
  registerLiveSeconds: (seconds: number) => void;
  wearGarment: (garmentId: string) => void;
  wearGarmentForMirror: (garmentId: string) => void;
  wearLook: (garmentIds: string[]) => void;
  openGarmentDetail: (garment: Garment) => void;
  openLookDetail: (look: Look) => void;
  startScanningFlow: (capturedPhotoUrl?: string) => void;
  finishScanReview: (items: Omit<Garment, 'id' | 'userId' | 'createdAt'>[]) => Promise<void>;
  toggleSaveLook: (lookId: string) => Promise<void>;
  toggleFavoriteGarment: (garmentId: string) => Promise<void>;
  deleteGarment: (garmentId: string) => Promise<void>;
  updateMirrorPhoto: (photoUrl: string) => Promise<void>;
  sendStylistPrompt: (text: string) => Promise<void>;
  refreshData: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

const STORAGE_KEY_JEV_QUOTA = 'mirobe_jev_quota_v1';
const STORAGE_KEY_MIRROR_QUOTA = 'mirobe_mirror_quota_v1';
const STORAGE_KEY_PHOTO_QUOTA = 'mirobe_photo_quota_v1';

interface StoredQuota {
  period: string;
  used: number;
}

function readQuota(key: string, period: string): StoredQuota {
  if (typeof window === 'undefined') return { period, used: 0 };
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null') as StoredQuota | null;
    return saved?.period === period ? saved : { period, used: 0 };
  } catch {
    return { period, used: 0 };
  }
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>('tr');
  const [deviceType, setDeviceType] = useState<DeviceType>('ios');
  const [tab, setTabState] = useState<TabType>('home');
  const [flow, setFlowState] = useState<FlowType>(null);
  const [garments, setGarments] = useState<Garment[]>([]);
  const [looks, setLooks] = useState<Look[]>([]);
  const [lastCapturedScanPhoto, setLastCapturedScanPhoto] = useState<string | null>(null);
  const [mirrorProfile, setMirrorProfile] = useState<MirrorProfile>({
    id: 'mirror_usr_01',
    userId: 'usr_deniz_01',
    name: 'Deniz',
    photoUrl: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1000&q=85',
    aspectRatio: '9:16',
    version: 'v2.4',
    createdAt: new Date().toISOString(),
  });

  const [activeWearingId, setActiveWearingId] = useState<string>('g_black_blazer');
  const [activeGarmentIds, setActiveGarmentIds] = useState<string[]>(['g_black_blazer']);
  const [activeMirrorRender, setActiveMirrorRender] = useState({
    fullUrl: TRYON_RENDERS['g_black_blazer'].fullUrl,
    previewUrl: TRYON_RENDERS['g_black_blazer'].previewUrl,
    title: TRYON_RENDERS['g_black_blazer'].title,
    isTransitioning: false,
  });

  const [selectedGarment, setSelectedGarment] = useState<Garment | null>(null);
  const [selectedLook, setSelectedLook] = useState<Look | null>(null);
  const [pendingDetectedGarments, setPendingDetectedGarments] = useState<Omit<Garment, 'id' | 'userId' | 'createdAt'>[]>(SCAN_SAMPLE_DETECTED);
  const [stylistMessages, setStylistMessages] = useState<StylistMessage[]>([]);
  const [isQuickChangeOpen, setIsQuickChangeOpen] = useState(false);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const todayKey = new Date().toISOString().slice(0, 10);
  const monthKey = new Date().toISOString().slice(0, 7);
  const [resolvedPlanId, setResolvedPlanId] = useState<'free' | 'premium' | 'pro'>(() => getLocalEntitlement().planId);
  const localEntitlement = { ...getLocalEntitlement(), planId: resolvedPlanId };
  const plan = MIROBE_PLANS[localEntitlement.planId];
  const [jevQuota, setJevQuota] = useState<StoredQuota>(() => readQuota(STORAGE_KEY_JEV_QUOTA, monthKey));
  const [mirrorQuota, setMirrorQuota] = useState<StoredQuota>(() => readQuota(STORAGE_KEY_MIRROR_QUOTA, monthKey));
  const [photoQuota, setPhotoQuota] = useState<StoredQuota>(() => readQuota(STORAGE_KEY_PHOTO_QUOTA, monthKey));
  const [liveMirror, setLiveMirrorState] = useState<LiveMirrorState>({
    status: 'idle',
    provider: 'none',
    remainingSeconds: MIROBE_LIMITS.maxAiMirrorSessionSeconds,
    sessionSeconds: 0,
    maxSessionSeconds: MIROBE_LIMITS.maxAiMirrorSessionSeconds,
    selectedGarmentIds: ['g_black_blazer'],
  });

  const t = translations[language];

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!(await configureRevenueCat('local-demo'))) return;
      const paidPlan = await getRevenueCatPlan();
      if (!cancelled && paidPlan) setResolvedPlanId(paidPlan);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setLanguage = (lang: Language) => {
    triggerHaptic('selection');
    setLanguageState(lang);
  };

  // Load initial data
  const refreshData = async () => {
    try {
      const [loadedGarments, loadedLooks, profile, messages] = await Promise.all([
        api.getWardrobeItems(),
        api.getLooks(),
        api.getMirrorProfile(),
        api.getStylistMessages(),
      ]);
      setGarments(loadedGarments);
      setLooks(loadedLooks);
      setMirrorProfile(profile);
      setStylistMessages(messages);

      // Preload initial adjacent garments into browser memory
      tryonService.prefetchGarments(loadedGarments.slice(0, 5).map((g) => [g.id]));
    } catch {
      // Fallback already handled inside API client
    }
  };

  useEffect(() => {
    refreshData();
  }, []);

  const setTab = (newTab: TabType) => {
    triggerHaptic('selection');
    setTabState(newTab);
    setFlowState(null); // Close overlays when switching primary tab
  };

  const setFlow = (newFlow: FlowType) => {
    triggerHaptic('light');
    setFlowState(newFlow);
  };

  const setLiveMirror = useCallback((state: Partial<LiveMirrorState>) => {
    setLiveMirrorState((previous) => ({ ...previous, ...state }));
  }, []);

  const registerJevDecision = useCallback(() => {
    const current = readQuota(STORAGE_KEY_JEV_QUOTA, monthKey);
    if (current.used >= plan.jevDecisions) return false;
    const updated = { period: monthKey, used: current.used + 1 };
    setJevQuota(updated);
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY_JEV_QUOTA, JSON.stringify(updated));
    return true;
  }, [monthKey, plan.jevDecisions, todayKey]);

  const registerLiveSeconds = useCallback((seconds: number) => {
    if (seconds <= 0) return;
    const current = readQuota(STORAGE_KEY_MIRROR_QUOTA, monthKey);
    const updated = { period: monthKey, used: Math.min(plan.videoSeconds, current.used + seconds) };
    setMirrorQuota(updated);
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY_MIRROR_QUOTA, JSON.stringify(updated));
  }, [monthKey, plan.videoSeconds]);

  const reservePhotoTokens = useCallback((tokens: number) => {
    const current = readQuota(STORAGE_KEY_PHOTO_QUOTA, monthKey);
    if (current.used + tokens > plan.photoTokens) return false;
    const updated = { period: monthKey, used: current.used + tokens };
    setPhotoQuota(updated);
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY_PHOTO_QUOTA, JSON.stringify(updated));
    return true;
  }, [monthKey, plan.photoTokens]);

  const refundPhotoTokens = useCallback((tokens: number) => {
    const current = readQuota(STORAGE_KEY_PHOTO_QUOTA, monthKey);
    const updated = { period: monthKey, used: Math.max(0, current.used - tokens) };
    setPhotoQuota(updated);
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY_PHOTO_QUOTA, JSON.stringify(updated));
  }, [monthKey]);

  /**
   * INSTANT CLOTHING CHANGE ENGINE (Most Important UX Rule)
   * 1. Immediate tactile haptic click
   * 2. Instant selection state
   * 3. Subtle blur & optimistic low-res preview crossfade (< 80ms)
   * 4. Seamless full-res transition with zero layout jitter
   */
  const wearGarment = (garmentId: string) => {
    triggerHaptic('medium');
    setActiveWearingId(garmentId);
    setActiveGarmentIds([garmentId]);

    const targetRender = TRYON_RENDERS[garmentId] || {
      fullUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=1000&q=90',
      previewUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=40',
      title: 'Mirobe Tailored Try-On',
    };

    // Begin subtle transition state
    setActiveMirrorRender((prev) => ({
      ...prev,
      isTransitioning: true,
      title: targetRender.title,
    }));

    // Optimistic image swap with fast crossfade
    const cached = tryonService.getCachedRender([garmentId]);
    const finalUrl = cached?.finalUrl || targetRender.fullUrl;
    const previewUrl = cached?.previewUrl || targetRender.previewUrl;

    // Immediately swap preview URL
    setActiveMirrorRender({
      fullUrl: finalUrl,
      previewUrl,
      title: targetRender.title,
      isTransitioning: true,
    });

    // Crossfade blur out smoothly after instant paint
    setTimeout(() => {
      setActiveMirrorRender((prev) => ({
        ...prev,
        isTransitioning: false,
      }));
    }, 180);

    // Also trigger prefetch of neighbor items in the current wardrobe
    const currentIndex = garments.findIndex((g) => g.id === garmentId);
    if (currentIndex !== -1) {
      const next1 = garments[(currentIndex + 1) % garments.length];
      const next2 = garments[(currentIndex + 2) % garments.length];
      const prev1 = garments[(currentIndex - 1 + garments.length) % garments.length];
      tryonService.prefetchGarments([[next1.id], [next2.id], [prev1.id]]);
    }
  };

  const wearLook = (garmentIds: string[]) => {
    const validIds = garmentIds.filter((id) => Boolean(id) && garments.some((garment) => garment.id === id));
    if (validIds.length === 0) return;
    triggerHaptic('medium');
    setActiveGarmentIds(validIds);
    setActiveWearingId(validIds[0]);
    const targetRender = TRYON_RENDERS[validIds[0]];
    if (targetRender) {
      setActiveMirrorRender({
        fullUrl: targetRender.fullUrl,
        previewUrl: targetRender.previewUrl,
        title: targetRender.title,
        isTransitioning: false,
      });
    }
  };

  const wearGarmentForMirror = (garmentId: string) => {
    const target = garments.find((garment) => garment.id === garmentId);
    if (!target) return;
    const nextIds = [
      ...activeGarmentIds.filter((id) => garments.find((garment) => garment.id === id)?.category !== target.category),
      garmentId,
    ];
    wearGarment(garmentId);
    setActiveGarmentIds(nextIds);
  };

  const openGarmentDetail = (garment: Garment) => {
    triggerHaptic('light');
    setSelectedGarment(garment);
    setFlow('garment-detail');
  };

  const openLookDetail = (look: Look) => {
    triggerHaptic('light');
    setSelectedLook(look);
    setFlow('look-detail');
  };

  const startScanningFlow = (capturedPhotoUrl?: string) => {
    triggerHaptic('medium');
    if (capturedPhotoUrl) {
      setLastCapturedScanPhoto(capturedPhotoUrl);
    }
    setFlow('scan-closet');
  };

  const finishScanReview = async (newItems: Omit<Garment, 'id' | 'userId' | 'createdAt'>[]) => {
    triggerHaptic('success');
    const created = await api.addMultipleWardrobeItems(newItems);
    
    // Register dynamic try-on renders for newly scanned items
    created.forEach((item) => {
      if (!TRYON_RENDERS[item.id]) {
        TRYON_RENDERS[item.id] = {
          fullUrl: item.imageUrl || item.cutoutUrl,
          previewUrl: item.cutoutUrl || item.imageUrl,
          title: `Mirobe Uyum — ${item.name}`,
        };
      }
    });

    setGarments((prev) => [...created, ...prev]);
    // Automatically select the first newly scanned garment to try on immediately
    if (created[0]) {
      wearGarment(created[0].id);
    }
    setFlow(null);
    setTab('mirror');
  };

  const toggleSaveLook = async (lookId: string) => {
    triggerHaptic('selection');
    await api.toggleSaveLook(lookId);
    setLooks((prev) => prev.map((l) => (l.id === lookId ? { ...l, saved: !l.saved } : l)));
  };

  const toggleFavoriteGarment = async (garmentId: string) => {
    triggerHaptic('selection');
    const updated = await api.toggleGarmentFavorite(garmentId);
    if (updated) {
      setGarments((prev) => prev.map((g) => (g.id === garmentId ? updated : g)));
    }
  };

  const deleteGarment = async (garmentId: string) => {
    triggerHaptic('medium');
    await api.deleteWardrobeItem(garmentId);
    setGarments((prev) => prev.filter((g) => g.id !== garmentId));
    if (selectedGarment?.id === garmentId) {
      setSelectedGarment(null);
      setFlow(null);
    }
  };

  const updateMirrorPhoto = async (photoUrl: string) => {
    triggerHaptic('success');
    const updated = await api.createMirrorProfile(photoUrl, 'Personal Mirror');
    setMirrorProfile(updated);
    setFlow(null);
    setTab('mirror');
  };

  const sendStylistPrompt = async (text: string) => {
    triggerHaptic('medium');
    if (!registerJevDecision()) {
      const quotaMessage: StylistMessage = {
        id: `msg_${Date.now()}`,
        sender: 'mirobe',
        text:
          language === 'tr'
            ? 'Bu dönemki Jev kombin hakkın doldu. Gardırobunu manuel seçebilir veya paketini yükseltebilirsin.'
            : 'Your Jev combination quota is used. Choose manually or upgrade your plan.',
        createdAt: new Date().toISOString(),
      };
      setStylistMessages((prev) => [...prev, quotaMessage]);
      return;
    }
    const userMessage: StylistMessage = {
      id: `msg_${Date.now()}`,
      sender: 'user',
      text,
      createdAt: new Date().toISOString(),
    };
    setStylistMessages((prev) => [...prev, userMessage]);

    await new Promise((resolve) => window.setTimeout(resolve, 220));
    const aiReply = await api.sendStylistMessage(text, language);
    setStylistMessages((prev) => [...prev, aiReply]);
    if (aiReply.garmentIds && aiReply.garmentIds.length > 0) {
      wearLook(aiReply.garmentIds);
      setTab('mirror');
    }
    triggerHaptic('light');
  };

  // Pre-filter compare looks (e.g. top 3 saved looks)
  const compareLooks = looks.slice(0, 3);

  return (
    <AppContext.Provider
      value={{
        language,
        setLanguage,
        t,
        deviceType,
        setDeviceType,
        tab,
        setTab,
        flow,
        setFlow,
        garments,
        looks,
        mirrorProfile,
        activeWearingId,
        activeGarmentIds,
        activeMirrorRender,
        selectedGarment,
        setSelectedGarment,
        selectedLook,
        setSelectedLook,
        lastCapturedScanPhoto,
        setLastCapturedScanPhoto,
        pendingDetectedGarments,
        setPendingDetectedGarments,
        stylistMessages,
        compareLooks,
        isQuickChangeOpen,
        setIsQuickChangeOpen,
        isCompareOpen,
        setIsCompareOpen,
        liveMirror,
        setLiveMirror,
        dailyJevDecisions: jevQuota.used,
        dailyJevLimit: plan.jevDecisions,
        monthlyAiSecondsUsed: mirrorQuota.used,
        monthlyAiSecondsLimit: plan.videoSeconds,
        monthlyAiSecondsRemaining: Math.max(0, plan.videoSeconds - mirrorQuota.used),
        planId: localEntitlement.planId,
        planLabel: plan.label,
        photoTokensUsed: photoQuota.used,
        photoTokensLimit: plan.photoTokens,
        photoTokensRemaining: Math.max(0, plan.photoTokens - photoQuota.used),
        reservePhotoTokens,
        refundPhotoTokens,
        registerJevDecision,
        registerLiveSeconds,
        wearGarment,
        wearGarmentForMirror,
        wearLook,
        openGarmentDetail,
        openLookDetail,
        startScanningFlow,
        finishScanReview,
        toggleSaveLook,
        toggleFavoriteGarment,
        deleteGarment,
        updateMirrorPhoto,
        sendStylistPrompt,
        refreshData,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
