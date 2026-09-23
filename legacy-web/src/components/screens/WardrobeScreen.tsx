import React, { useState } from 'react';
import { Plus, Search, Sparkles, X, Camera } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { triggerHaptic } from '../../services/haptics';
import { GarmentCategory } from '../../types';

export const WardrobeScreen: React.FC = () => {
  const { garments, openGarmentDetail, wearGarment, activeWearingId, startScanningFlow, setTab, t } = useApp();
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filterCategories = [
    { id: 'all', label: t.wardrobe.categories.all },
    { id: 'top', label: t.wardrobe.categories.top },
    { id: 'bottom', label: t.wardrobe.categories.bottom },
    { id: 'outerwear', label: t.wardrobe.categories.outerwear },
    { id: 'dress', label: t.wardrobe.categories.dress },
    { id: 'shoes', label: t.wardrobe.categories.shoes },
    { id: 'accessory', label: t.wardrobe.categories.accessory },
  ];

  const filteredGarments = garments.filter((item) => {
    const matchesCategory = activeCategory === 'all' || item.category === activeCategory;
    const matchesSearch =
      searchQuery.trim() === '' ||
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.colors.some((c) => c.toLowerCase().includes(searchQuery.toLowerCase())) ||
      item.styleTags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  return (
    <div
      id="screen-wardrobe"
      className="flex-1 w-full bg-[#FBF9F5] px-5 py-3 flex flex-col overflow-y-auto no-scrollbar"
    >
      {/* Top Header */}
      <div className="flex items-center justify-between pt-1 pb-2">
        <div>
          <h1 className="font-serif text-3xl text-[#1A1918] font-normal tracking-tight">
            {t.wardrobe.title}
          </h1>
          <p className="text-xs text-[#78746D] mt-0.5 font-light">
            {garments.length} {t.wardrobe.archivedPieces}
          </p>
        </div>

        {/* Action Button to open Live Camera Clothing Scanner */}
        <button
          type="button"
          id="btn-wardrobe-add-clothing"
          onClick={() => startScanningFlow()}
          className="px-3.5 py-1.5 rounded-full bg-[#1A1918] text-[#FBF9F5] text-xs font-medium flex items-center space-x-1.5 hover:bg-[#2C2B29] active:scale-95 transition-all shadow-xs cursor-pointer"
          title="Kamera ile Kıyafet Tara"
        >
          <Camera className="w-4 h-4 text-amber-300" />
          <span>{t.wardrobe.addNew}</span>
        </button>
      </div>

      {/* Minimalist Search Bar */}
      <div className="relative my-2">
        <Search className="w-4 h-4 text-[#8C877E] absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t.wardrobe.searchPlaceholder}
          className="w-full pl-9 pr-8 py-2 text-xs bg-[#EFECE6] border border-transparent focus:border-[#D5D0C6] focus:bg-white rounded-xl text-[#1A1918] placeholder-[#8C877E] outline-none transition-all"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8C877E] hover:text-[#1A1918]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Category Filter Pills */}
      <div className="flex space-x-2 overflow-x-auto no-scrollbar py-2 -mx-5 px-5 select-none">
        {filterCategories.map((cat) => {
          const isSelected = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              id={`filter-pill-${cat.id}`}
              onClick={() => {
                triggerHaptic('selection');
                setActiveCategory(cat.id);
              }}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-200 cursor-pointer ${
                isSelected
                  ? 'bg-[#1A1918] text-[#FBF9F5] shadow-xs'
                  : 'bg-[#EFECE6] text-[#78746D] hover:text-[#1A1918] border border-[#E8E4DC]'
              }`}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Clean 2-column e-commerce style product grid */}
      <div className="grid grid-cols-2 gap-3.5 pt-3 pb-6 flex-1">
        {filteredGarments.map((garment) => {
          const isWearing = activeWearingId === garment.id;

          return (
            <div
              key={garment.id}
              id={`garment-card-${garment.id}`}
              onClick={() => openGarmentDetail(garment)}
              className="group flex flex-col bg-[#EFECE6] rounded-2xl border border-[#E8E4DC] p-3 transition-all duration-200 hover:border-[#1A1918]/25 hover:shadow-xs cursor-pointer relative"
            >
              {/* Quick Try-On button overlay */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  wearGarment(garment.id);
                  setTab('mirror');
                }}
                className="absolute top-2.5 right-2.5 px-2 py-1 rounded-full bg-white/95 hover:bg-[#1A1918] text-[#1A1918] hover:text-[#FBF9F5] flex items-center space-x-1 text-[10px] font-medium transition-colors shadow-xs z-10 cursor-pointer"
                title={t.wardrobe.tryOn}
              >
                <Sparkles className="w-3 h-3 text-amber-500" />
                <span>Dene</span>
              </button>

              {/* Wearing indicator badge */}
              {isWearing && (
                <div className="absolute top-2.5 left-2.5 z-10 px-2 py-0.5 rounded-full bg-[#1A1918] text-[#FBF9F5] text-[9px] font-medium tracking-wide uppercase">
                  {t.wardrobe.wearing}
                </div>
              )}

              {/* Product Cutout Image Frame */}
              <div className="w-full aspect-[4/5] rounded-xl bg-white flex items-center justify-center p-3 mb-2.5 transition-transform duration-300 group-hover:scale-[1.02]">
                <img
                  src={garment.studioUrl || garment.imageUrl || garment.cutoutUrl}
                  alt={garment.name}
                  className="w-full h-full object-contain mix-blend-multiply"
                  loading="lazy"
                />
              </div>

              {/* Card Label */}
              <div className="mt-auto">
                <h3 className="text-xs font-semibold text-[#1A1918] truncate">
                  {garment.name}
                </h3>
                <p className="text-[10px] text-[#78746D] uppercase tracking-wider mt-0.5">
                  {garment.subcategory || garment.category}
                </p>
              </div>
            </div>
          );
        })}

        {filteredGarments.length === 0 && (
          <div className="col-span-2 py-12 text-center text-xs text-[#8C877E] space-y-3">
            <p>{t.wardrobe.noPieces}</p>
            <button
              type="button"
              onClick={() => startScanningFlow()}
              className="px-4 py-2 rounded-xl bg-[#1A1918] text-white text-xs font-medium cursor-pointer"
            >
              Kamerayla Kıyafet Tara
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
