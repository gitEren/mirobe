import React, { useRef, useState, useEffect } from 'react';
import { Camera, ChevronLeft, Check, Upload, HelpCircle, SwitchCamera, AlertCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { triggerHaptic } from '../../services/haptics';
import { useCamera } from '../../hooks/useCamera';

export const CreateMirrorScreen: React.FC = () => {
  const { setFlow, updateMirrorPhoto, t } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedPhoto, setSelectedPhoto] = useState<string>(
    'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1000&q=85'
  );
  const [showTips, setShowTips] = useState<boolean>(false);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);

  const {
    videoRef,
    isActive,
    simulatedMode,
    start,
    stop,
    flip,
    capture,
  } = useCamera('user');

  const samplePoses = [
    {
      id: 'pose_01',
      title: 'Doğal Duruş',
      url: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1000&q=85',
    },
    {
      id: 'pose_02',
      title: 'Stüdyo Boy',
      url: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=1000&q=85',
    },
    {
      id: 'pose_03',
      title: 'Editoryal',
      url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=1000&q=85',
    },
  ];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const objectUrl = URL.createObjectURL(file);
      setSelectedPhoto(objectUrl);
      setIsCameraActive(false);
      stop();
      triggerHaptic('success');
    }
  };

  const handleToggleLiveCamera = () => {
    triggerHaptic('medium');
    if (!isCameraActive) {
      setIsCameraActive(true);
      start('user');
    } else {
      setIsCameraActive(false);
      stop();
    }
  };

  const handleCaptureLiveSnapshot = () => {
    triggerHaptic('shutter');
    let frame = '';
    if (isActive && !simulatedMode) {
      frame = capture();
    }
    if (!frame) {
      frame = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=1000&q=90';
    }
    setSelectedPhoto(frame);
    setIsCameraActive(false);
    stop();
  };

  const handleConfirmPhoto = async () => {
    triggerHaptic('medium');
    stop();
    await updateMirrorPhoto(selectedPhoto);
    setFlow('scan-closet');
  };

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return (
    <div
      id="screen-create-mirror"
      className="flex-1 w-full bg-[#FBF9F5] flex flex-col justify-between px-5 py-4 overflow-y-auto no-scrollbar select-none"
    >
      {/* Top Header */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            id="btn-back-mirror-create"
            onClick={() => {
              triggerHaptic('light');
              stop();
              setFlow('welcome');
            }}
            className="p-1 -ml-1 text-[#1A1918] hover:text-[#78746D] transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-6 h-6 stroke-[1.5]" />
          </button>
          <span className="text-xs tracking-widest uppercase text-[#78746D] font-medium">
            Adım 1 / 2
          </span>
          <button
            type="button"
            id="btn-toggle-photo-tips"
            onClick={() => {
              triggerHaptic('light');
              setShowTips(!showTips);
            }}
            className="p-1 text-[#78746D] hover:text-[#1A1918] transition-colors cursor-pointer"
          >
            <HelpCircle className="w-5 h-5 stroke-[1.5]" />
          </button>
        </div>

        <div className="mb-4">
          <h2 className="font-serif text-2xl sm:text-3xl text-[#1A1918] font-normal">
            Kişisel Aynanı Oluştur
          </h2>
          <p className="text-xs text-[#78746D] mt-1 leading-relaxed">
            Kameran ile boydan bir fotoğraf çek veya galeriden seç. Kıyafetlerin bu fotoğraf üzerinde gerçekçi şekilde görünecektir.
          </p>
        </div>
      </div>

      {/* Photography Tips Accordion */}
      {showTips && (
        <div className="mb-3 p-3.5 bg-[#EFECE6] rounded-xl border border-[#E8E4DC] text-xs space-y-1.5 animate-fade-in">
          <p className="font-medium text-[#1A1918] text-[11px] uppercase tracking-wider">
            Fotoğraf Çekim İpuçları
          </p>
          <ul className="text-[#68655E] space-y-1 list-disc list-inside">
            <li>Tüm vücut baştan ayağa görünür olmalıdır</li>
            <li>Doğal ışıkta, kollar serbest duruş önerilir</li>
            <li>Aşırı bol mont veya kaban olmadan çekim yapınız</li>
          </ul>
        </div>
      )}

      {/* Viewfinder / Live Video Camera Frame */}
      <div className="relative w-full aspect-[3/4] max-h-[420px] rounded-2xl overflow-hidden bg-[#1A1918] border border-[#E8E4DC] shadow-inner flex items-center justify-center my-auto">
        {isCameraActive ? (
          <div className="relative w-full h-full">
            {!simulatedMode ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover scale-x-[-1]"
              />
            ) : (
              <img
                src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=1000&q=90"
                alt="Live Camera Simulation"
                className="w-full h-full object-cover"
              />
            )}

            {/* In-camera capture floating button */}
            <div className="absolute bottom-4 inset-x-0 flex items-center justify-center space-x-4 z-20">
              <button
                type="button"
                onClick={flip}
                className="w-10 h-10 rounded-full bg-black/60 backdrop-blur-md text-white flex items-center justify-center border border-white/20 cursor-pointer"
                title="Kamerayı Çevir"
              >
                <SwitchCamera className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={handleCaptureLiveSnapshot}
                className="w-14 h-14 rounded-full bg-white text-[#1A1918] flex items-center justify-center shadow-lg active:scale-95 transition-transform cursor-pointer"
                title="Fotoğrafı Çek"
              >
                <Camera className="w-6 h-6" />
              </button>
            </div>
          </div>
        ) : (
          <img
            src={selectedPhoto}
            alt="Mirror Full Body"
            className="w-full h-full object-cover transition-opacity duration-200"
          />
        )}

        {/* Silhouette & Framing Guides */}
        {!isCameraActive && (
          <div className="absolute inset-4 border border-[#FBF9F5]/40 rounded-xl pointer-events-none flex flex-col justify-between p-3">
            <div className="flex justify-between text-[10px] text-[#FBF9F5]/70 tracking-widest uppercase">
              <span>9:16 Boy Oranı</span>
              <span>Ayna Kalibrasyonu</span>
            </div>
            <div className="mx-auto w-32 h-52 border border-dashed border-[#FBF9F5]/45 rounded-[36px] flex items-center justify-center">
              <span className="text-[10px] text-[#FBF9F5]/80 font-light tracking-wider uppercase">
                Duruş Kılavuzu
              </span>
            </div>
            <div className="flex justify-between items-end text-[10px] text-[#FBF9F5]/70">
              <span>Doğal Işık</span>
              <span>Hazır ✓</span>
            </div>
          </div>
        )}
      </div>

      {/* Sample presets switcher & actions */}
      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] text-[#78746D] uppercase tracking-wider">
            Örnek Modeller
          </span>
          <div className="flex items-center space-x-1.5">
            {samplePoses.map((pose) => (
              <button
                key={pose.id}
                type="button"
                onClick={() => {
                  triggerHaptic('selection');
                  setIsCameraActive(false);
                  stop();
                  setSelectedPhoto(pose.url);
                }}
                className={`text-[10px] px-2.5 py-1 rounded-full border transition-all cursor-pointer ${
                  selectedPhoto === pose.url && !isCameraActive
                    ? 'border-[#1A1918] bg-[#1A1918] text-[#FBF9F5]'
                    : 'border-[#E8E4DC] text-[#78746D] hover:border-[#1A1918]'
                }`}
              >
                {pose.title}
              </button>
            ))}
          </div>
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            id="btn-mirror-choose-photo"
            onClick={() => {
              triggerHaptic('light');
              fileInputRef.current?.click();
            }}
            className="py-2.5 px-3 rounded-xl border border-[#E8E4DC] bg-[#EFECE6] text-[#1A1918] text-xs font-medium flex items-center justify-center space-x-2 hover:bg-[#E6E1D7] transition-colors cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Galeriden Seç</span>
          </button>

          <button
            type="button"
            id="btn-mirror-take-photo"
            onClick={handleToggleLiveCamera}
            className={`py-2.5 px-3 rounded-xl border text-xs font-medium flex items-center justify-center space-x-2 transition-colors cursor-pointer ${
              isCameraActive
                ? 'bg-amber-400 text-black border-amber-300'
                : 'border-[#E8E4DC] bg-[#EFECE6] text-[#1A1918] hover:bg-[#E6E1D7]'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>{isCameraActive ? 'Kamerayı Kapat' : 'Kamerayı Aç'}</span>
          </button>
        </div>

        {/* Confirm CTA */}
        <button
          type="button"
          id="btn-mirror-confirm-photo"
          onClick={handleConfirmPhoto}
          className="w-full py-3.5 px-6 rounded-xl bg-[#1A1918] text-[#FBF9F5] text-sm font-medium tracking-wide shadow-sm hover:bg-[#2C2B29] active:scale-[0.99] transition-all flex items-center justify-center space-x-2 cursor-pointer"
        >
          <Check className="w-4 h-4" />
          <span>Bu Fotoğrafı Kullan & Kıyafet Tara</span>
        </button>
      </div>
    </div>
  );
};
