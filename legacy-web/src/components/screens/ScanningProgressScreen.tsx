import React, { useEffect, useState } from 'react';
import { Sparkles, Check, Loader2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { triggerHaptic } from '../../services/haptics';
import { processScannedGarment } from '../../services/scanService';

export const ScanningProgressScreen: React.FC = () => {
  const {
    setFlow,
    lastCapturedScanPhoto,
    pendingDetectedGarments,
    setPendingDetectedGarments,
    language,
    t,
    reservePhotoTokens,
    refundPhotoTokens,
  } = useApp();

  const [progress, setProgress] = useState(15);
  const [currentStatusText, setCurrentStatusText] = useState(
    language === 'tr' ? 'Kamera karesi inceleniyor...' : 'Analyzing camera frame...'
  );

  const stages = [
    {
      title: language === 'tr' ? 'Kıyafet sınırları algılanıyor' : 'Detecting garment boundaries',
      done: progress >= 30,
    },
    {
      title:
        language === 'tr'
          ? 'Arka plan ayrıştırılıyor & temizleniyor'
          : 'Segmenting & cleaning background',
      done: progress >= 60,
    },
    {
      title:
        language === 'tr'
          ? 'Renk paleti ve kumaş dokusu analiz ediliyor'
          : 'Analyzing color palette & fabric',
      done: progress >= 80,
    },
    {
      title:
        language === 'tr'
          ? 'Mekan ve stil etiketleri atanıyor (Pub, Ofis vb.)'
          : 'Assigning occasion & style tags',
      done: progress >= 95,
    },
    {
      title: language === 'tr' ? 'Dijital gardrobunuza aktarılıyor' : 'Ready for your wardrobe',
      done: progress >= 100,
    },
  ];

  const primaryPiece = pendingDetectedGarments[0] || {
    name: language === 'tr' ? 'Algılanan Kıyafet' : 'Detected Piece',
    category: 'top',
    imageUrl: lastCapturedScanPhoto || '',
    cutoutUrl: lastCapturedScanPhoto || '',
  };

  useEffect(() => {
    let isCancelled = false;
    const isWearingScan = sessionStorage.getItem('last_scan_mode') === 'wearing';

    // Gradually ramp progress to 75% while awaiting real AI vision
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev < 75) {
          const next = prev + Math.floor(Math.random() * 6) + 4;
          if (next >= 30 && prev < 30) {
            setCurrentStatusText(
              language === 'tr'
                ? 'OpenRouter AI kumaş & model analizi...'
                : 'OpenRouter AI analyzing fabric & model...'
            );
          } else if (next >= 60 && prev < 60) {
            setCurrentStatusText(
              language === 'tr'
                ? 'Kıyafet dekupe ediliyor...'
                : 'Segmenting garment cutout...'
            );
          }
          return Math.min(next, 75);
        }
        return prev;
      });
    }, 180);

    // Call real scan processing
    const runScan = async () => {
      if (!lastCapturedScanPhoto) return;
      const prepTokens = 10;
      if (!reservePhotoTokens(prepTokens)) {
        setProgress(100);
        setCurrentStatusText(
          language === 'tr'
            ? 'Fotoğraf kotan doldu · paketini yükselt veya sonra tekrar dene.'
            : 'Photo quota used · upgrade your plan or try again later.'
        );
        return;
      }
      try {
        const scanned = await processScannedGarment(
          lastCapturedScanPhoto,
          language,
          isWearingScan
        );

        if (!isCancelled) {
            setPendingDetectedGarments([
              {
                name: scanned.name,
                category: scanned.category,
                subcategory: scanned.subcategory,
                colors: scanned.colors,
                material: scanned.material,
                occasions: scanned.occasions,
                styleTags: scanned.styleTags,
                imageUrl: scanned.imageUrl || lastCapturedScanPhoto,
                cutoutUrl: scanned.cutoutUrl || lastCapturedScanPhoto,
                studioUrl: scanned.studioUrl || scanned.imageUrl,
                renderer: scanned.renderer,
                qualityStatus: scanned.qualityStatus,
                favorite: true,
              },
            ]);

            // Rapidly finish to 100%
            setProgress(100);
            setCurrentStatusText(
              language === 'tr' ? 'Tarama tamamlandı!' : 'Scan completed!'
            );
            triggerHaptic('success');

            setTimeout(() => {
              setFlow('review-scan');
            }, 600);
        }
      } catch (err) {
        refundPhotoTokens(prepTokens);
        console.warn('Scanning process error, completing with fallback:', err);
        setProgress(100);
        setTimeout(() => {
          setFlow('review-scan');
        }, 600);
      }
    };

    runScan();

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [lastCapturedScanPhoto, language, refundPhotoTokens, reservePhotoTokens]);

  return (
    <div
      id="screen-scanning-progress"
      className="flex-1 w-full bg-[#FBF9F5] flex flex-col justify-between px-6 py-6 overflow-y-auto no-scrollbar select-none"
    >
      {/* Top Title */}
      <div className="text-center pt-2">
        <span className="text-[10px] tracking-widest uppercase text-[#78746D] font-mono">
          Mirobe AI Vision Engine
        </span>
        <h2 className="font-serif text-2xl sm:text-3xl text-[#1A1918] font-normal mt-1">
          {t.scan.scanningProgressTitle}
        </h2>
        <p className="text-xs text-[#78746D] mt-1 max-w-xs mx-auto leading-relaxed">
          {t.scan.scanningSubtitle}
        </p>
      </div>

      {/* Center Image Scanner Visual with laser sweep */}
      <div className="relative w-full max-w-xs mx-auto aspect-[4/5] rounded-3xl overflow-hidden bg-white border border-[#E8E4DC] shadow-lg my-auto flex items-center justify-center p-3">
        <img
          src={primaryPiece.cutoutUrl || primaryPiece.imageUrl}
          alt="Scanning Garment"
          className="w-full h-full object-contain mix-blend-multiply transition-all duration-300"
        />

        {/* Animated Laser Scanning Beam */}
        <div
          className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-amber-400 to-transparent shadow-[0_0_15px_rgba(251,191,36,0.9)] pointer-events-none transition-all duration-200"
          style={{
            top: `${progress}%`,
          }}
        />

        {/* Shimmer overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-black/10 pointer-events-none" />

        {/* Floating AI pill badge */}
        <div className="absolute bottom-3 inset-x-3 flex justify-center">
          <span className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full bg-black/75 backdrop-blur-md text-white text-[11px] font-medium shadow-md">
            <Sparkles className="w-3.5 h-3.5 text-amber-300 animate-spin" />
            <span>
              {currentStatusText} — %{progress}
            </span>
          </span>
        </div>
      </div>

      {/* Progress Stages Checklist */}
      <div className="space-y-2 max-w-xs mx-auto w-full pt-2 pb-4">
        {stages.map((stage, idx) => (
          <div key={idx} className="flex items-center space-x-2.5 text-xs">
            <div
              className={`w-4 h-4 rounded-full flex items-center justify-center transition-colors ${
                stage.done ? 'bg-[#1A1918] text-white' : 'bg-[#EFECE6] text-[#A39E93]'
              }`}
            >
              {stage.done ? (
                <Check className="w-2.5 h-2.5 stroke-[2.5]" />
              ) : (
                <div className="w-1.5 h-1.5 rounded-full bg-current" />
              )}
            </div>
            <span className={stage.done ? 'text-[#1A1918] font-medium' : 'text-[#8C877E]'}>
              {stage.title}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
