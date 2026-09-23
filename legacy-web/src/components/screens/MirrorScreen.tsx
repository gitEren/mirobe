import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CircleStop,
  Info,
  Mic,
  RefreshCw,
  ScanLine,
  Sparkles,
  SwitchCamera,
  Video,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useCamera } from '../../hooks/useCamera';
import { useLiveMirror } from '../../hooks/useLiveMirror';
import { triggerHaptic } from '../../services/haptics';
import { api } from '../../services/api';
import { MIROBE_LIMITS } from '../../services/entitlements';

const DEMO_PERSON_IMAGE =
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=1200&q=90';

export const MirrorScreen: React.FC = () => {
  const {
    garments,
    activeWearingId,
    activeGarmentIds,
    wearGarmentForMirror,
    setTab,
    startScanningFlow,
    t,
    monthlyAiSecondsRemaining,
    setLiveMirror,
    registerLiveSeconds,
    planId,
    photoTokensRemaining,
    reservePhotoTokens,
    refundPhotoTokens,
  } = useApp();
  const [activeCategory, setActiveCategory] = useState('all');
  const [message, setMessage] = useState('Kıyafeti seç, AI aynayı başlat ve hareket et.');
  const [isRecording, setIsRecording] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [isRailOpen, setIsRailOpen] = useState(false);
  const [photoResultUrl, setPhotoResultUrl] = useState<string | null>(null);
  const [isPhotoGenerating, setIsPhotoGenerating] = useState(false);
  const outputVideoRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);

  const camera = useCamera('user');
  const selectedGarment = garments.find((garment) => garment.id === activeWearingId) || garments[0];
  const activeLookGarments = useMemo(
    () => activeGarmentIds.map((id) => garments.find((garment) => garment.id === id)).filter(Boolean),
    [activeGarmentIds, garments]
  );
  const handleLiveMessage = useCallback((nextMessage: string) => {
    setMessage(nextMessage);
    window.setTimeout(() => setMessage('Kıyafet seçebilir, kamerayı çevirebilir veya kayda başlayabilirsin.'), 4200);
  }, []);
  const live = useLiveMirror({
    stream: camera.stream,
    simulatedMode: camera.simulatedMode,
    planId,
    monthlySecondsRemaining: monthlyAiSecondsRemaining,
    onUsage: registerLiveSeconds,
    onMessage: handleLiveMessage,
  });

  useEffect(() => {
    void camera.start('user');
    return () => camera.stop();
    // Mirror owns one camera lifecycle; flipping is handled by the hook itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (outputVideoRef.current) outputVideoRef.current.srcObject = live.remoteStream;
  }, [live.remoteStream]);

  useEffect(() => {
    setLiveMirror({
      status: live.status,
      provider: live.status === 'live' || live.status === 'connecting' ? 'fal-lucy2' : live.status === 'fallback' ? 'local-overlay' : 'none',
      remainingSeconds: live.remainingSeconds,
      sessionSeconds: live.sessionSeconds,
      maxSessionSeconds: live.maxSessionSeconds,
      selectedGarmentIds: activeGarmentIds,
      message,
    });
  }, [activeGarmentIds, live.maxSessionSeconds, live.remainingSeconds, live.sessionSeconds, live.status, message, setLiveMirror]);

  useEffect(() => {
    const reference = selectedGarment?.cutoutUrl || selectedGarment?.imageUrl;
    if (reference) live.updateReference(reference);
  }, [selectedGarment?.cutoutUrl, selectedGarment?.imageUrl, live.updateReference]);

  const categories = [
    { id: 'all', label: t.wardrobe.categories.all },
    { id: 'top', label: t.wardrobe.categories.top },
    { id: 'bottom', label: t.wardrobe.categories.bottom },
    { id: 'outerwear', label: t.wardrobe.categories.outerwear },
    { id: 'dress', label: t.wardrobe.categories.dress },
    { id: 'shoes', label: t.wardrobe.categories.shoes },
    { id: 'accessory', label: t.wardrobe.categories.accessory },
  ];
  const filteredGarments = useMemo(
    () => garments.filter((garment) => activeCategory === 'all' || garment.category === activeCategory),
    [activeCategory, garments]
  );

  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const isFalLive = live.status === 'live' && Boolean(live.remoteStream);
  const isBusy = live.status === 'connecting';
  const isFallback = live.status === 'fallback' || camera.simulatedMode || !isFalLive;

  const selectGarment = (garmentId: string) => {
    triggerHaptic('medium');
    wearGarmentForMirror(garmentId);
    const garment = garments.find((item) => item.id === garmentId);
    if (garment) {
      live.updateReference(garment.cutoutUrl || garment.imageUrl);
      setMessage(live.status === 'live' || live.status === 'connecting' ? `${garment.name} canlı aynaya gönderildi` : `${garment.name} seçildi`);
    }
    setIsRailOpen(false);
  };

  const startAiMirror = () => {
    triggerHaptic('medium');
    if (planId === 'free') {
      setMessage('Video Mirror Premium ve Pro paketlerinde açık · Profil > AI paketi & tokenlar');
      return;
    }
    const reference = selectedGarment?.cutoutUrl || selectedGarment?.imageUrl;
    if (live.beginSession(reference)) setMessage('AI ayna bağlanıyor… hareket etmeye devam et.');
  };

  const stopAiMirror = () => {
    triggerHaptic('light');
    live.stopSession('AI oturumu durduruldu · yerel önizleme açık');
  };

  const handleRecord = () => {
    if (planId === 'free') {
      setMessage('Video Mirror Premium ve Pro paketlerinde açık. Fotoğrafla denemeyi kullanabilirsin.');
      return;
    }
    if (isRecording) {
      recorderRef.current?.stop();
      setIsRecording(false);
      return;
    }
    const recordStream = live.remoteStream;
    if (!recordStream || typeof MediaRecorder === 'undefined') {
      setMessage('Önce ücretli Video Mirror bağlantısını başlat.');
      return;
    }

    recorderChunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : undefined;
    const recorder = new MediaRecorder(recordStream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recorderChunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(recorderChunksRef.current, { type: mimeType || 'video/webm' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'mirobe-mirror.webm';
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('Mirror klibi cihazına kaydedildi.');
    };
    recorder.start(500);
    recorderRef.current = recorder;
    setIsRecording(true);
    setMessage('Mirror kaydediliyor…');
  };

  const handlePhotoTryOn = async () => {
    if (isPhotoGenerating) return;
    const targetGarments = activeLookGarments.filter(Boolean) as typeof garments;
    if (targetGarments.length === 0 && selectedGarment) targetGarments.push(selectedGarment);
    if (targetGarments.length === 0) {
      setMessage('Önce gardıroptan bir kıyafet seç.');
      setIsRailOpen(true);
      return;
    }
    if (!reservePhotoTokens(MIROBE_LIMITS.photoTryOnTokens)) {
      setMessage(`Fotoğraf kotan doldu · ${planId === 'free' ? 'Premium ile devam et' : 'daha sonra tekrar dene'}.`);
      return;
    }

    setIsPhotoGenerating(true);
    setPhotoResultUrl(null);
    setMessage('Kıyafet fotoğrafa işleniyor · yüzün ve duruşun korunuyor…');
    try {
      const personImage = camera.capture() || DEMO_PERSON_IMAGE;
      const result = await api.requestPhotoTryOn(personImage, targetGarments);
      if (!result?.imageUrl) {
        refundPhotoTokens(MIROBE_LIMITS.photoTryOnTokens);
        setMessage('Fotoğraf üretilemedi · tokenın iade edildi, tekrar deneyebilirsin.');
        return;
      }
      setPhotoResultUrl(result.imageUrl);
      setMessage('Fotoğraf hazır · seçtiğin kombin üzerinde.');
    } catch (error) {
      refundPhotoTokens(MIROBE_LIMITS.photoTryOnTokens);
      if ((error as { code?: string })?.code === 'OPENROUTER_CREDITS_REQUIRED') {
        setMessage('OpenRouter görsel kredisi yok · tokenın iade edildi.');
      } else {
        setMessage('Fotoğraf üretilemedi · tokenın iade edildi.');
      }
    } finally {
      setIsPhotoGenerating(false);
    }
  };

  const closeMirror = () => {
    if (isRecording) recorderRef.current?.stop();
    live.stopSession('');
    camera.stop();
    setTab('wardrobe');
  };

  return (
    <div id="screen-mirobe-mirror" className="mirror-screen relative flex-1 min-h-0 w-full overflow-hidden bg-[#070707] text-white select-none">
      <div className="absolute inset-0 overflow-hidden bg-[#121110]">
        {!camera.simulatedMode && (
          <video
            ref={camera.videoRef}
            autoPlay
            playsInline
            muted
            className={`mirror-camera absolute inset-0 h-full w-full object-cover ${camera.facingMode === 'user' ? '-scale-x-100' : ''} ${isFalLive ? 'opacity-0' : 'opacity-100'}`}
          />
        )}
        {camera.simulatedMode && <img src={DEMO_PERSON_IMAGE} alt="Demo mirror" className="absolute inset-0 h-full w-full object-cover" />}
        <video
          ref={outputVideoRef}
          autoPlay
          playsInline
          muted
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${isFalLive ? 'opacity-100' : 'opacity-0'}`}
        />
        {!isFalLive && !photoResultUrl && selectedGarment?.cutoutUrl && (
          <div className="pointer-events-none absolute inset-x-0 top-[31%] z-[5] flex justify-center opacity-75 transition-opacity duration-300">
            <img
              src={selectedGarment.cutoutUrl}
              alt="Yerel kıyafet önizlemesi"
              className="h-[43vh] w-[78vw] max-w-[360px] object-contain drop-shadow-[0_14px_22px_rgba(0,0,0,0.22)]"
            />
          </div>
        )}
        {photoResultUrl && (
          <img
            src={photoResultUrl}
            alt="Seçilen kombinle fotoğraf önizlemesi"
            className="absolute inset-0 z-10 h-full w-full object-cover"
          />
        )}
        {isFallback && !isFalLive && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="mt-[-28%] rounded-full border border-white/20 bg-black/20 px-4 py-2 text-center text-[11px] text-white/80 backdrop-blur-md">
              <span className="mr-1.5 text-amber-300">✦</span>{' '}
              {live.status === 'connecting' ? 'Kamera açık · AI bağlantısı bekleniyor' : 'Yerel kamera açık'}
            </div>
          </div>
        )}
        <div className="mirror-vignette pointer-events-none absolute inset-0" />
      </div>

      <header className="relative z-20 flex items-center justify-between px-4 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={closeMirror} className="mirror-icon-button" aria-label="Mirror kapat"><X className="h-4 w-4" /></button>
          <div className="rounded-full border border-white/15 bg-black/45 px-3 py-1.5 text-[10px] font-medium tracking-wide text-white/90 backdrop-blur-xl">
            <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${live.status === 'live' ? 'bg-emerald-400 shadow-[0_0_10px_#55d98b]' : 'bg-amber-300'}`} />
            {live.status === 'live' ? 'AI LIVE' : live.status === 'connecting' ? 'BAĞLANIYOR' : 'LOCAL PREVIEW'}
          </div>
        </div>
        <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1 text-[11px] font-semibold tracking-[0.18em] text-white/90"><Sparkles className="h-3.5 w-3.5 text-amber-300" /> MIROBE</div>
        <div className="flex items-center gap-2">
          <div className="rounded-full border border-white/15 bg-black/45 px-2.5 py-1.5 font-mono text-[10px] text-white/80 backdrop-blur-xl">{formatTime(live.remainingSeconds)}</div>
          <button type="button" onClick={() => void camera.flip()} className="mirror-icon-button" aria-label="Kamerayı değiştir"><SwitchCamera className="h-4 w-4" /></button>
        </div>
      </header>

      <div className="relative z-20 flex items-start justify-between px-4 pt-2">
        <div className="max-w-[72%] rounded-2xl border border-white/10 bg-black/35 px-3 py-2 backdrop-blur-xl">
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">Canlı ayna</p>
          <p className="mt-0.5 text-xs font-medium text-white/90">{message}</p>
        </div>
        <button type="button" onClick={() => setShowInfo((open) => !open)} className="mirror-icon-button" aria-label="Mirror bilgi"><Info className="h-4 w-4" /></button>
      </div>

      {showInfo && (
        <div className="absolute left-4 right-4 top-28 z-40 rounded-3xl border border-white/15 bg-[#161514]/95 p-4 text-xs leading-relaxed text-white/75 shadow-2xl backdrop-blur-2xl">
          <p className="font-semibold text-white">Drape seviyesinde gerçek canlılık</p>
          <p className="mt-1.5">Fal bağlantısı yüzünü, hareketini ve ortamını koruyarak seçtiğin referans kıyafeti canlı görüntüye taşır. Bağlantı veya kota yoksa kamera kapanmaz; yerel önizleme devam eder.</p>
          <p className="mt-2 text-[10px] text-amber-200/80">Aylık AI Mirror: {Math.max(0, monthlyAiSecondsRemaining - live.sessionSeconds)} sn kaldı</p>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 z-30 px-3 pb-3 pt-20">
        <div className="mx-auto flex max-w-xl flex-col gap-2.5">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0 rounded-2xl border border-white/15 bg-black/55 px-3 py-2.5 backdrop-blur-2xl">
              <p className="truncate text-xs font-semibold text-white">{selectedGarment?.name || 'Kıyafet seçilmedi'}</p>
              <p className="mt-1 max-w-[46vw] truncate text-[10px] text-white/55">
                {activeLookGarments.length > 1
                  ? activeLookGarments.map((garment) => garment?.name).filter(Boolean).join(' · ')
                  : 'Referans kıyafet'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {photoResultUrl && (
                <button type="button" onClick={() => setPhotoResultUrl(null)} className="mirror-secondary-button">Kameraya dön</button>
              )}
              <button type="button" onClick={handleRecord} className={`mirror-action-button ${isRecording ? 'border-red-300/60 bg-red-500/90 text-white' : ''}`} aria-label="Kayıt">
                {isRecording ? <CircleStop className="h-4 w-4" /> : <span className="h-3 w-3 rounded-full bg-current" />}
              </button>
              {live.status === 'live' || live.status === 'connecting' ? (
                <button type="button" onClick={stopAiMirror} className="flex h-10 items-center gap-1.5 rounded-full bg-white px-4 text-xs font-bold text-[#141312] shadow-xl"><CircleStop className="h-4 w-4" /> Durdur</button>
              ) : (
                <button type="button" onClick={startAiMirror} className="flex h-10 items-center gap-1.5 rounded-full bg-amber-300 px-4 text-xs font-bold text-[#171411] shadow-[0_0_26px_rgba(251,191,36,0.25)]"><Video className="h-4 w-4" /> {planId === 'free' ? 'Video kilitli' : 'Video Mirror'}</button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-black/45 px-2 py-2 backdrop-blur-2xl">
            <button type="button" onClick={handlePhotoTryOn} disabled={isPhotoGenerating} className="mirror-photo-button">
              <Camera className="h-4 w-4" /> {isPhotoGenerating ? 'Fotoğraf hazırlanıyor…' : 'Fotoğrafla dene'}
            </button>
            <span className="text-[10px] text-white/55">{photoTokensRemaining} fotoğraf tokenı</span>
          </div>

          {!isRailOpen ? (
            <div className="flex items-center gap-2 rounded-2xl border border-white/12 bg-black/55 px-2.5 py-2 backdrop-blur-2xl">
              <button type="button" onClick={() => setIsRailOpen(true)} className="flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-2 text-[10px] font-semibold text-black">
                <span className="text-amber-500">✦</span> Gardıropu aç
              </button>
              <div className="min-w-0 flex-1 truncate text-[10px] text-white/65">
                {activeLookGarments.length > 0
                  ? activeLookGarments.map((garment) => garment?.name).filter(Boolean).join(' · ')
                  : 'Kendi kombinini seç'}
              </div>
              <span className="shrink-0 text-[10px] text-white/40">{activeGarmentIds.length} parça</span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                  {categories.map((category) => (
                    <button key={category.id} type="button" onClick={() => setActiveCategory(category.id)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[10px] font-medium transition ${activeCategory === category.id ? 'bg-white text-black' : 'border border-white/15 bg-black/35 text-white/65'}`}>{category.label}</button>
                  ))}
                </div>
                <button type="button" onClick={() => setIsRailOpen(false)} className="shrink-0 rounded-full border border-white/15 bg-black/55 px-3 py-1.5 text-[10px] text-white/75">Bitti</button>
              </div>

              <div className="mirror-wardrobe-rail flex gap-2 overflow-x-auto no-scrollbar rounded-3xl border border-white/10 bg-black/60 p-2 backdrop-blur-2xl">
                <button type="button" onClick={() => { camera.stop(); startScanningFlow(); }} className="flex w-[72px] shrink-0 flex-col items-center justify-center rounded-2xl border border-dashed border-amber-200/45 bg-amber-200/10 px-2 py-2 text-center text-[10px] text-amber-100"><ScanLine className="mb-1 h-5 w-5" /> Tara<span className="text-[9px] text-white/55">yeni parça</span></button>
                {filteredGarments.map((garment) => {
                  const selected = activeGarmentIds.includes(garment.id) || garment.id === activeWearingId;
                  return (
                    <button key={garment.id} type="button" onClick={() => selectGarment(garment.id)} className={`relative w-[76px] shrink-0 rounded-2xl p-1.5 text-left transition ${selected ? 'bg-white text-black ring-2 ring-amber-300' : 'bg-white/10 text-white/80 hover:bg-white/15'}`}>
                      {selected && <span className="absolute right-1 top-1 z-10 rounded-full bg-amber-300 px-1.5 py-0.5 text-[8px] font-bold text-black">AKTİF</span>}
                      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-white/90 p-1"><img src={garment.cutoutUrl || garment.imageUrl} alt={garment.name} className="h-full w-full object-contain mix-blend-multiply" /></div>
                      <p className="mt-1 truncate text-[9px] font-semibold">{garment.name}</p>
                      <p className={`text-[8px] uppercase ${selected ? 'text-black/50' : 'text-white/45'}`}>{garment.category}</p>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between px-1 text-[10px] text-white/45">
                <span className="flex items-center gap-1"><Mic className="h-3 w-3" /> Jev: “pub, date, ofis…” de</span>
                <span className="flex items-center gap-1"><RefreshCw className="h-3 w-3" /> {live.sessionSeconds}/{live.maxSessionSeconds}s</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
