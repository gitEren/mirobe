import React from 'react';
import { ArrowUpRight, Plus, Sparkles, Camera, Eye, Zap } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { triggerHaptic } from '../../services/haptics';

export const HomeScreen: React.FC = () => {
  const {
    looks,
    garments,
    wearGarment,
    openLookDetail,
    openGarmentDetail,
    setTab,
    startScanningFlow,
    t,
  } = useApp();

  const heroLook = looks[0] || {
    id: 'hero',
    title: 'City Layers',
    fullBodyImageUrl:
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=1000&q=90',
  };

  const recentlyAdded = garments.slice(0, 4);
  const wearAgainPieces = garments.filter((g) => (g.wornCount || 0) > 8).slice(0, 4);

  return (
    <div
      id="screen-home-editorial"
      className="flex-1 w-full bg-[#FBF9F5] px-5 py-3 flex flex-col space-y-6 overflow-y-auto no-scrollbar"
    >
      {/* Top Editorial Brand Header */}
      <div className="flex items-center justify-between pt-1">
        <div>
          <h1 className="font-serif text-3xl sm:text-4xl text-[#1A1918] font-normal tracking-tight">
            {t.brand}
          </h1>
          <p className="text-[10px] text-[#78746D] tracking-widest uppercase font-medium">
            {t.tagline}
          </p>
        </div>

        <button
          type="button"
          id="btn-home-scan-quick"
          onClick={() => {
            triggerHaptic('medium');
            startScanningFlow();
          }}
          className="px-3 py-1.5 rounded-full bg-[#1A1918] text-[#FBF9F5] flex items-center space-x-1.5 text-xs font-medium hover:bg-[#2C2B29] transition-all shadow-xs cursor-pointer"
          title="Kamera ile Kıyafet Tara"
        >
          <Camera className="w-3.5 h-3.5 text-amber-300" />
          <span>Kıyafet Tara</span>
        </button>
      </div>

      {/* CORE PROMISE ACTION BANNERS: 1-Tap Camera Scan & 1-Tap Live Mirror */}
      <div className="grid grid-cols-2 gap-3">
        {/* Banner 1: Scan Clothes */}
        <div
          id="card-action-scan-clothes"
          onClick={() => {
            triggerHaptic('medium');
            startScanningFlow();
          }}
          className="group p-3.5 rounded-2xl bg-[#EFECE6] border border-[#E8E4DC] hover:border-[#1A1918]/30 transition-all cursor-pointer flex flex-col justify-between"
        >
          <div className="w-8 h-8 rounded-full bg-[#1A1918] text-[#FBF9F5] flex items-center justify-center mb-2 shadow-xs group-hover:scale-105 transition-transform">
            <Camera className="w-4 h-4 text-amber-300" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-[#1A1918]">
              {t.home.scanActionTitle}
            </h3>
            <p className="text-[10px] text-[#78746D] mt-0.5 leading-tight">
              {t.home.scanActionDesc}
            </p>
          </div>
        </div>

        {/* Banner 2: Live Mirror */}
        <div
          id="card-action-live-mirror"
          onClick={() => {
            triggerHaptic('medium');
            setTab('mirror');
          }}
          className="group p-3.5 rounded-2xl bg-[#1A1918] text-[#FBF9F5] border border-black/10 hover:bg-[#2C2B29] transition-all cursor-pointer flex flex-col justify-between shadow-xs"
        >
          <div className="w-8 h-8 rounded-full bg-white/15 text-white flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
            <Sparkles className="w-4 h-4 text-amber-300" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-white">
              {t.home.liveMirrorTitle}
            </h3>
            <p className="text-[10px] text-white/70 mt-0.5 leading-tight">
              {t.home.liveMirrorDesc}
            </p>
          </div>
        </div>
      </div>

      {/* Section 01: Your Daily Edit (Large Editorial Hero Card) */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-[#78746D] font-medium">
            {t.home.dailyEdit}
          </span>
          <span className="text-[11px] text-[#8C877E] font-serif italic">
            {t.home.curatedForToday}
          </span>
        </div>

        <div
          id="card-daily-edit-hero"
          onClick={() => {
            if (heroLook.garmentIds && heroLook.garmentIds[0]) {
              wearGarment(heroLook.garmentIds[0]);
              setTab('mirror');
            }
          }}
          className="group relative w-full aspect-[4/5] rounded-3xl overflow-hidden bg-[#EFECE6] border border-[#E8E4DC] shadow-xs cursor-pointer"
        >
          <img
            src={heroLook.fullBodyImageUrl}
            alt="Editorial blazer styling"
            className="w-full h-full object-cover object-top group-hover:scale-[1.02] transition-transform duration-500"
          />

          {/* Editorial overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent flex flex-col justify-end p-6 text-[#FBF9F5]">
            <span className="text-[10px] tracking-widest uppercase text-white/80 font-mono mb-1">
              Günün Kombin İlhamı
            </span>
            <h2 className="font-serif text-2xl sm:text-3xl font-normal leading-tight">
              {t.home.heroSubtitle}
            </h2>
            <p className="text-xs text-white/80 mt-1 font-light">
              Sabah kahvesinden akşam buluşmalarına sofistike geçiş.
            </p>

            <div className="mt-4 flex items-center justify-between pt-2 border-t border-white/20">
              <span className="text-xs text-white font-medium flex items-center space-x-1">
                <span>{t.home.tryThisEdit}</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </span>
              <span className="text-[10px] text-white/70">Gardrobundan</span>
            </div>
          </div>
        </div>
      </div>

      {/* Section 02: For Today (Rapid Outfit Swaps) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-wider text-[#78746D] font-medium">
            {t.home.forToday}
          </h3>
          <button
            type="button"
            onClick={() => setTab('looks')}
            className="text-[11px] text-[#1A1918] hover:underline cursor-pointer"
          >
            Tümünü Gör
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {looks.slice(1, 3).map((look) => (
            <div
              key={look.id}
              onClick={() => openLookDetail(look)}
              className="group flex flex-col rounded-2xl overflow-hidden bg-[#EFECE6] border border-[#E8E4DC] cursor-pointer"
            >
              <div className="w-full aspect-[3/4] overflow-hidden relative">
                <img
                  src={look.fullBodyImageUrl}
                  alt={look.title}
                  className="w-full h-full object-cover group-hover:scale-103 transition-transform duration-300"
                />
                <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-md text-white text-[9px] uppercase">
                  {look.occasion}
                </div>
              </div>
              <div className="p-2.5">
                <p className="text-xs font-semibold text-[#1A1918] truncate">{look.title}</p>
                <p className="text-[10px] text-[#78746D] mt-0.5">3 gardrop parçası</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Section 03: Recently Added Pieces */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-wider text-[#78746D] font-medium">
            {t.home.recentlyAdded}
          </h3>
          <button
            type="button"
            onClick={() => setTab('wardrobe')}
            className="text-[11px] text-[#1A1918] hover:underline cursor-pointer"
          >
            Gardrop
          </button>
        </div>

        <div className="flex space-x-3 overflow-x-auto no-scrollbar -mx-5 px-5 select-none">
          {recentlyAdded.map((garment) => (
            <div
              key={garment.id}
              onClick={() => openGarmentDetail(garment)}
              className="flex-shrink-0 w-28 p-2.5 rounded-2xl bg-[#EFECE6] border border-[#E8E4DC] cursor-pointer group hover:border-[#1A1918]/20 transition-all"
            >
              <div className="w-full aspect-square rounded-xl bg-white p-2 mb-2">
                <img
                  src={garment.studioUrl || garment.imageUrl || garment.cutoutUrl}
                  alt={garment.name}
                  className="w-full h-full object-contain mix-blend-multiply group-hover:scale-105 transition-transform"
                />
              </div>
              <p className="text-xs font-semibold text-[#1A1918] truncate">{garment.name}</p>
              <p className="text-[9px] text-[#78746D] uppercase mt-0.5">{garment.category}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Section 04: Wear It Again */}
      <div className="space-y-3 pb-6">
        <div className="flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-wider text-[#78746D] font-medium">
            Sık Giyilen Temel Parçalar
          </h3>
          <span className="text-[11px] text-[#8C877E]">Favoriler</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {wearAgainPieces.map((piece) => (
            <div
              key={piece.id}
              onClick={() => {
                wearGarment(piece.id);
                setTab('mirror');
              }}
              className="flex items-center space-x-3 p-2.5 rounded-2xl bg-[#EFECE6] border border-[#E8E4DC] cursor-pointer hover:border-[#1A1918]/25 transition-colors"
            >
              <div className="w-12 h-12 rounded-xl bg-white p-1 flex-shrink-0">
                <img
                  src={piece.studioUrl || piece.imageUrl || piece.cutoutUrl}
                  alt={piece.name}
                  className="w-full h-full object-contain mix-blend-multiply"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-[#1A1918] truncate">{piece.name}</p>
                <p className="text-[10px] text-[#78746D] mt-0.5">{piece.wornCount || 12} kez giyildi</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
