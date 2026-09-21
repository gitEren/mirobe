import React, { useRef, useState, useEffect } from 'react';
import {
  Camera,
  ChevronLeft,
  Image as ImageIcon,
  Sparkles,
  Zap,
  ZapOff,
  SwitchCamera,
  Layers,
  AlertCircle,
  Shirt,
  Info,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { triggerHaptic } from '../../services/haptics';
import { useCamera } from '../../hooks/useCamera';
import { Garment } from '../../types';

export const ScanClosetScreen: React.FC = () => {
  const { setFlow, setLastCapturedScanPhoto, setPendingDetectedGarments, t, language } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [targetMode, setTargetMode] = useState<'wearing' | 'hanger'>('wearing');
  const [scanMode, setScanMode] = useState<'single' | 'batch'>('single');
  const [showHelperTip, setShowHelperTip] = useState(false);

  const {
    videoRef,
    isActive,
    isLoading,
    simulatedMode,
    isTorchOn,
    torchSupported,
    facingMode,
    start,
    stop,
    flip,
    capture,
    toggleTorch,
  } = useCamera(targetMode === 'wearing' ? 'user' : 'environment');

  // Switch camera when target mode changes
  useEffect(() => {
    start(targetMode === 'wearing' ? 'user' : 'environment');
    return () => {
      stop();
    };
  }, [start, stop, targetMode]);

  // Handle Shutter Press: Captures real frame from webcam
  const handleCaptureShutter = () => {
    triggerHaptic('shutter');
    let capturedUrl = '';

    if (isActive && !simulatedMode) {
      capturedUrl = capture();
    }

    // Fallback if camera stream didn't yield a frame
    if (!capturedUrl) {
      capturedUrl =
        'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=1000&q=85';
    }

    setLastCapturedScanPhoto(capturedUrl);
    // Mark whether this was a wearing scan for the background service
    sessionStorage.setItem('last_scan_mode', targetMode);

    // Initial placeholder while AI vision analyzes in background
    const initialPiece: Omit<Garment, 'id' | 'userId' | 'createdAt'> = {
      name: language === 'tr' ? 'Taranan Kıyafet' : 'Scanned Garment',
      category: targetMode === 'wearing' ? 'top' : 'outerwear',
      subcategory: targetMode === 'wearing' ? 'Sweatshirt & Tişört' : 'Kıyafet',
      colors: [language === 'tr' ? 'Analiz ediliyor...' : 'Analyzing...'],
      material: language === 'tr' ? 'Doğal Kumaş' : 'Natural Fabric',
      styleTags: ['Casual', 'Modern'],
      occasions: ['pub', 'bar', 'günlük', 'hafta sonu', 'casual'],
      imageUrl: capturedUrl,
      cutoutUrl: capturedUrl,
      originalImageUrl: capturedUrl,
      scanSource: targetMode,
      confidence: 0.5,
      favorite: true,
    };

    setPendingDetectedGarments([initialPiece]);
    stop();
    setFlow('scanning');
  };

  // Handle gallery file selection
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      triggerHaptic('success');
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = () => {
        const objectUrl = reader.result as string;
        setLastCapturedScanPhoto(objectUrl);
        sessionStorage.setItem('last_scan_mode', 'hanger');

        const detectedPiece: Omit<Garment, 'id' | 'userId' | 'createdAt'> = {
          name: file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ') || 'Galeriden Kıyafet',
          category: 'top',
          subcategory: 'Üst Giyim',
          colors: ['Doğal Tonlar'],
          material: 'Premium Kumaş',
          styleTags: ['Casual', 'Favori'],
          occasions: ['günlük', 'pub', 'hafta sonu', 'kahve'],
          imageUrl: objectUrl,
          cutoutUrl: objectUrl,
          originalImageUrl: objectUrl,
          scanSource: 'gallery',
          confidence: 0.55,
          favorite: true,
        };

        setPendingDetectedGarments([detectedPiece]);
        stop();
        setFlow('scanning');
      };
      reader.readAsDataURL(file);
    }
  };

  // Quick preset for instant test
  const handlePresetSelect = (presetType: 'sweatshirt' | 'coat') => {
    triggerHaptic('medium');
    sessionStorage.setItem('last_scan_mode', 'wearing');
    const presets: Record<string, Omit<Garment, 'id' | 'userId' | 'createdAt'>> = {
      sweatshirt: {
        name: 'Bej Bisiklet Yaka Sweatshirt',
        category: 'top',
        subcategory: 'Sweatshirt & Triko',
        colors: ['Bej / Oatmeal', 'Krem'],
        material: '%100 Pamuk Şardonlu İki İplik',
        styleTags: ['Casual', 'Streetwear', 'Minimalist', 'Oversize'],
        occasions: ['pub', 'bar', 'günlük', 'hafta sonu', 'arkadaşlar', 'casual', 'kahve'],
        imageUrl:
          'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=800&q=80',
        cutoutUrl:
          'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=600&q=80',
        favorite: true,
        originalImageUrl:
          'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=800&q=80',
        scanSource: 'demo',
        confidence: 0.9,
      },
      coat: {
        name: 'Kaşmir Kruvaze Kaban',
        category: 'outerwear',
        subcategory: 'Kaban',
        colors: ['Kamel / Kum'],
        material: 'Kaşmir & Yün',
        styleTags: ['Zarif', 'Kışlık'],
        occasions: ['ofis', 'şehir', 'yağmurlu', 'gece', 'seyahat'],
        imageUrl:
          'https://images.unsplash.com/photo-1544441893-675973e31985?auto=format&fit=crop&w=800&q=80',
        cutoutUrl:
          'https://images.unsplash.com/photo-1544441893-675973e31985?auto=format&fit=crop&w=600&q=80',
        favorite: true,
        originalImageUrl:
          'https://images.unsplash.com/photo-1544441893-675973e31985?auto=format&fit=crop&w=800&q=80',
        scanSource: 'demo',
        confidence: 0.9,
      },
    };

    setLastCapturedScanPhoto(presets[presetType].imageUrl);
    setPendingDetectedGarments([presets[presetType]]);
    stop();
    setFlow('scanning');
  };

  return (
    <div
      id="screen-scan-closet"
      className="flex-1 w-full h-full bg-[#111110] text-[#FBF9F5] flex flex-col justify-between overflow-hidden select-none relative"
    >
      {/* ============================================================ */}
      {/* 1. CAMERA VIEWPORT                                          */}
      {/* ============================================================ */}
      <div className="absolute inset-0 z-0 bg-black overflow-hidden flex items-center justify-center">
        {!simulatedMode && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover object-center ${
              facingMode === 'user' ? 'scale-x-[-1]' : ''
            }`}
          />
        )}

        {simulatedMode && (
          <div className="relative w-full h-full">
            <img
              src="https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=1000&q=85"
              alt="Live Clothing Scan Rack"
              className="w-full h-full object-cover"
            />
            <div className="absolute top-16 inset-x-4 p-2.5 rounded-xl bg-black/70 backdrop-blur-md border border-white/15 text-[11px] text-[#FBF9F5] flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-amber-300 flex-shrink-0" />
              <span>Canlı kamera önizleme devrede. Gerçek kameranızı kullanmak için izin verin.</span>
            </div>
          </div>
        )}

        {/* Cinematic Vignette */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/80 pointer-events-none" />

        {/* ============================================================ */}
        {/* VIEWING GUIDE: Dedicated Chest/Torso Frame for 'Wearing'     */}
        {/* ============================================================ */}
        {targetMode === 'wearing' ? (
          <div className="absolute inset-x-8 top-[36%] bottom-[24%] pointer-events-none flex flex-col items-center justify-center">
            {/* Torso Bounding Box */}
            <div className="w-full max-w-[280px] h-full border-2 border-dashed border-amber-300/80 rounded-3xl bg-white/[0.03] backdrop-blur-[0.5px] p-3 flex flex-col items-center justify-between shadow-[0_0_30px_rgba(251,191,36,0.15)] animate-pulse">
              <div className="flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-black/60 text-[10px] font-medium text-amber-300">
                <Shirt className="w-3.5 h-3.5" />
                <span>GÖVDE / KIYAFET ALANI</span>
              </div>

              <div className="text-center px-2">
                <p className="text-[11px] font-medium text-white/95 bg-black/70 px-3 py-1 rounded-full backdrop-blur-md">
                  {language === 'tr'
                    ? 'Üstünüzdeki sweatshirt / tişörtü buraya hizalayın'
                    : 'Align your worn sweatshirt / top here'}
                </p>
                <p className="text-[9px] text-white/70 mt-1">
                  {language === 'tr'
                    ? '(Yüzünüz değil, giydiğiniz kıyafet taranır)'
                    : '(Focuses on the garment, not your face)'}
                </p>
              </div>

              <div className="flex items-center space-x-2 text-[9px] text-white/80">
                <span className="bg-black/50 px-2 py-0.5 rounded-full">AI Dekupe</span>
                <span className="bg-black/50 px-2 py-0.5 rounded-full">Kumaş & Renk</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="absolute inset-x-8 top-[24%] bottom-[25%] pointer-events-none flex flex-col items-center justify-center">
            {/* Hanger / Flat Garment Bounding Box */}
            <div className="w-full max-w-[300px] h-full border-2 border-dashed border-white/70 rounded-3xl bg-white/[0.02] p-4 flex flex-col items-center justify-between shadow-[0_0_30px_rgba(0,0,0,0.4)]">
              <div className="flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-black/60 text-[10px] font-medium text-white/90">
                <Layers className="w-3.5 h-3.5 text-blue-300" />
                <span>ASKI / ZEMİN ALANI</span>
              </div>

              <p className="text-[11px] font-medium text-white/90 bg-black/70 px-3 py-1 rounded-full backdrop-blur-md">
                {language === 'tr'
                  ? 'Askıdaki veya zemindeki kıyafeti çerçeveye alın'
                  : 'Center the hanging or laid out garment'}
              </p>

              <div className="flex items-center space-x-2 text-[9px] text-white/80">
                <span className="bg-black/50 px-2 py-0.5 rounded-full">Otomatik Kenar Kırpma</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* 2. TOP HEADER BAR                                            */}
      {/* ============================================================ */}
      <div className="relative z-20 flex items-center justify-between px-4 pt-4 pb-2">
        <button
          type="button"
          id="btn-back-scan-closet"
          onClick={() => {
            triggerHaptic('light');
            stop();
            setFlow(null);
          }}
          className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md text-white hover:bg-black/70 flex items-center justify-center border border-white/15 active:scale-95 transition-all cursor-pointer shadow-lg"
          title="Geri"
        >
          <ChevronLeft className="w-5 h-5 stroke-[2]" />
        </button>

        {/* Scanner Active Pill */}
        <div className="flex items-center space-x-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/15 text-white text-xs font-medium shadow-lg">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          <Sparkles className="w-3.5 h-3.5 text-amber-300" />
          <span>{language === 'tr' ? 'AI Kıyafet Tarama' : 'AI Closet Scan'}</span>
        </div>

        {/* Right Controls: Flash & Camera Flip */}
        <div className="flex items-center space-x-2">
          {torchSupported && (
            <button
              type="button"
              id="btn-toggle-torch"
              onClick={toggleTorch}
              className={`w-10 h-10 rounded-full backdrop-blur-md flex items-center justify-center border transition-all cursor-pointer ${
                isTorchOn
                  ? 'bg-amber-400 text-black border-amber-300 shadow-md'
                  : 'bg-black/50 text-white border-white/15'
              }`}
              title="Flaş"
            >
              {isTorchOn ? <Zap className="w-4 h-4 fill-black" /> : <ZapOff className="w-4 h-4" />}
            </button>
          )}

          <button
            type="button"
            id="btn-flip-camera"
            onClick={flip}
            className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md text-white hover:bg-black/70 flex items-center justify-center border border-white/15 active:scale-95 transition-all cursor-pointer shadow-lg"
            title="Kamerayı Değiştir (Ön/Arka)"
          >
            <SwitchCamera className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 3. DEDICATED BOTTOM CONTROLS SHEET (Zero Overlaps)           */}
      {/* ============================================================ */}
      <div className="relative z-20 bg-black/85 backdrop-blur-xl border-t border-white/15 rounded-t-3xl px-5 pt-3 pb-6 space-y-3.5 shadow-2xl">
        {/* Mode Selector Tabs (Top of sheet) */}
        <div className="flex items-center justify-center p-1 rounded-full bg-white/10 max-w-xs mx-auto border border-white/10">
          <button
            type="button"
            id="btn-mode-wearing"
            onClick={() => {
              triggerHaptic('selection');
              setTargetMode('wearing');
            }}
            className={`flex-1 flex items-center justify-center space-x-1.5 py-1.5 px-3 rounded-full text-xs font-medium transition-all cursor-pointer ${
              targetMode === 'wearing'
                ? 'bg-amber-400 text-black font-semibold shadow-md'
                : 'text-white/75 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{language === 'tr' ? 'Üstümdeki Kıyafet' : 'Worn On Me'}</span>
          </button>

          <button
            type="button"
            id="btn-mode-hanger"
            onClick={() => {
              triggerHaptic('selection');
              setTargetMode('hanger');
            }}
            className={`flex-1 flex items-center justify-center space-x-1.5 py-1.5 px-3 rounded-full text-xs font-medium transition-all cursor-pointer ${
              targetMode === 'hanger'
                ? 'bg-white text-black font-semibold shadow-md'
                : 'text-white/75 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>{language === 'tr' ? 'Askı / Zemin' : 'Hanger / Flat'}</span>
          </button>
        </div>

        {/* Quick Test Chip: Bej Sweatshirt (Cleanly integrated without clutter) */}
        <div className="flex items-center justify-between px-2 pt-0.5 text-[11px] text-white/60">
          <span>{language === 'tr' ? 'Hızlı test etmek isterseniz:' : 'Quick test preset:'}</span>
          <button
            type="button"
            onClick={() => handlePresetSelect('sweatshirt')}
            className="text-[11px] font-semibold text-amber-300 hover:text-amber-200 underline flex items-center space-x-1 cursor-pointer"
          >
            <span>✨ Bej Sweatshirt</span>
          </button>
        </div>

        {/* Hidden Multi-file Input for Gallery */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileInput}
        />

        {/* Main Action Bar: Gallery, Large Shutter, Batch Switcher */}
        <div className="flex items-center justify-between px-4 pt-1">
          {/* Gallery Button */}
          <button
            type="button"
            id="btn-scan-choose-photos"
            onClick={() => {
              triggerHaptic('light');
              fileInputRef.current?.click();
            }}
            className="flex flex-col items-center space-y-1 text-white/80 hover:text-white transition-colors cursor-pointer group"
          >
            <div className="w-12 h-12 rounded-full bg-white/10 group-hover:bg-white/20 flex items-center justify-center border border-white/15 transition-colors">
              <ImageIcon className="w-5 h-5 text-white/90" />
            </div>
            <span className="text-[10px] font-medium">{t.scan.choosePhotos}</span>
          </button>

          {/* LARGE SHUTTER BUTTON */}
          <button
            type="button"
            id="btn-shutter-capture"
            onClick={handleCaptureShutter}
            className="relative group p-1.5 rounded-full border-4 border-white/80 flex items-center justify-center active:scale-95 transition-transform cursor-pointer shadow-[0_0_30px_rgba(255,255,255,0.25)] hover:border-white"
            title="Fotoğraf Çek ve Tara"
          >
            <div className="w-16 h-16 rounded-full bg-white group-hover:bg-amber-100 flex items-center justify-center transition-colors shadow-inner">
              <Camera className="w-7 h-7 text-black stroke-[2.2]" />
            </div>
          </button>

          {/* Batch Mode Toggle */}
          <button
            type="button"
            id="btn-toggle-scan-mode"
            onClick={() => {
              triggerHaptic('selection');
              setScanMode(scanMode === 'single' ? 'batch' : 'single');
            }}
            className="flex flex-col items-center space-y-1 text-white/80 hover:text-white transition-colors cursor-pointer group"
          >
            <div
              className={`w-12 h-12 rounded-full flex items-center justify-center border transition-all ${
                scanMode === 'batch'
                  ? 'bg-amber-400 text-black border-amber-300'
                  : 'bg-white/10 group-hover:bg-white/20 border-white/15 text-white/90'
              }`}
            >
              <Layers className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-medium">
              {scanMode === 'batch' ? 'Toplu' : 'Tek Parça'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
