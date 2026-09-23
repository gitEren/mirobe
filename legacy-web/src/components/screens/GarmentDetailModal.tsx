import React from 'react';
import { ChevronLeft, Heart, Sparkles, Trash2, Calendar, Tag, Layers } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { triggerHaptic } from '../../services/haptics';

export const GarmentDetailModal: React.FC = () => {
  const {
    selectedGarment,
    setFlow,
    setTab,
    wearGarment,
    toggleFavoriteGarment,
    deleteGarment,
    looks,
  } = useApp();

  if (!selectedGarment) return null;

  const handleTryOnNow = () => {
    triggerHaptic('medium');
    wearGarment(selectedGarment.id);
    setFlow(null);
    setTab('mirror');
  };

  const handleToggleFav = async () => {
    await toggleFavoriteGarment(selectedGarment.id);
  };

  const handleDelete = async () => {
    if (confirm(`Remove "${selectedGarment.name}" from your wardrobe?`)) {
      await deleteGarment(selectedGarment.id);
    }
  };

  // Find looks that feature this garment
  const matchingLooks = looks.filter((l) => l.garmentIds.includes(selectedGarment.id));

  return (
    <div
      id="modal-garment-detail"
      className="fixed inset-0 z-50 bg-[#FBF9F5] flex flex-col justify-between overflow-y-auto no-scrollbar"
    >
      {/* Top Navigation */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <button
          type="button"
          id="btn-back-garment-detail"
          onClick={() => {
            triggerHaptic('light');
            setFlow(null);
          }}
          className="p-1 -ml-1 text-[#1A1918] hover:text-[#78746D] transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-6 h-6 stroke-[1.5]" />
        </button>
        <span className="text-xs uppercase tracking-widest text-[#78746D] font-medium">
          {selectedGarment.category}
        </span>
        <div className="flex items-center space-x-2">
          <button
            type="button"
            id="btn-fav-garment"
            onClick={handleToggleFav}
            className="p-1.5 text-[#1A1918] hover:text-rose-600 transition-colors"
          >
            <Heart
              className={`w-5 h-5 ${
                selectedGarment.favorite ? 'fill-rose-600 text-rose-600' : 'text-[#1A1918]'
              }`}
            />
          </button>
          <button
            type="button"
            id="btn-delete-garment"
            onClick={handleDelete}
            className="p-1.5 text-[#78746D] hover:text-rose-600 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="px-6 py-2 flex-1 flex flex-col space-y-5">
        {/* Large Product Cutout Frame */}
        <div className="w-full aspect-square max-h-[380px] rounded-3xl bg-[#EFECE6] border border-[#E8E4DC] flex items-center justify-center p-8 shadow-sm">
          <img
            src={selectedGarment.cutoutUrl || selectedGarment.imageUrl}
            alt={selectedGarment.name}
            className="w-full h-full object-contain mix-blend-multiply"
          />
        </div>

        {/* Garment Information */}
        <div className="space-y-2">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-serif text-2xl text-[#1A1918] font-normal leading-tight">
                {selectedGarment.name}
              </h2>
              <p className="text-xs text-[#78746D] uppercase tracking-wider mt-1">
                {selectedGarment.subcategory || selectedGarment.category} • {selectedGarment.colors.join(', ')}
              </p>
            </div>
            <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-[#EFECE6] border border-[#E8E4DC] text-[#1A1918]">
              {selectedGarment.material || 'Premium Fabric'}
            </span>
          </div>

          {/* Style Tags */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {selectedGarment.styleTags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] text-[#68655E] bg-[#EFECE6] px-2.5 py-0.5 rounded-full"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>

        {/* Metadata & Usage stats */}
        <div className="grid grid-cols-2 gap-3 p-3.5 bg-[#EFECE6] rounded-2xl border border-[#E8E4DC] text-xs">
          <div className="flex items-center space-x-2.5">
            <Calendar className="w-4 h-4 text-[#78746D]" />
            <div>
              <p className="text-[10px] text-[#78746D] uppercase">Last Worn</p>
              <p className="font-medium text-[#1A1918]">{selectedGarment.lastWorn || 'Recently'}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2.5">
            <Layers className="w-4 h-4 text-[#78746D]" />
            <div>
              <p className="text-[10px] text-[#78746D] uppercase">Wear Count</p>
              <p className="font-medium text-[#1A1918]">{selectedGarment.wornCount || 1} times</p>
            </div>
          </div>
        </div>

        {/* Associated Looks */}
        {matchingLooks.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-[#78746D] font-medium">
              Looks featuring this piece
            </p>
            <div className="flex space-x-3 overflow-x-auto no-scrollbar pb-2">
              {matchingLooks.map((look) => (
                <div
                  key={look.id}
                  onClick={() => {
                    wearGarment(selectedGarment.id);
                    setFlow(null);
                    setTab('mirror');
                  }}
                  className="flex-shrink-0 w-24 rounded-xl overflow-hidden bg-[#EFECE6] border border-[#E8E4DC] cursor-pointer group"
                >
                  <div className="w-full aspect-[3/4] overflow-hidden">
                    <img
                      src={look.fullBodyImageUrl}
                      alt={look.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                  <p className="text-[10px] font-medium text-[#1A1918] p-1.5 truncate text-center">
                    {look.title}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Sticky Action Bar */}
      <div className="p-5 sticky bottom-0 bg-[#FBF9F5]/95 backdrop-blur-md border-t border-[#E8E4DC]">
        <button
          type="button"
          id="btn-garment-try-on-now"
          onClick={handleTryOnNow}
          className="w-full py-3.5 px-6 rounded-xl bg-[#1A1918] text-[#FBF9F5] text-sm font-medium tracking-wide shadow-sm hover:bg-[#2C2B29] active:scale-[0.99] transition-all flex items-center justify-center space-x-2 cursor-pointer"
        >
          <Sparkles className="w-4 h-4 text-amber-100" />
          <span>Try On in Mirror</span>
        </button>
      </div>
    </div>
  );
};
