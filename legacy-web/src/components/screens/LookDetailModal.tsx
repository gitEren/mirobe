import React, { useState } from 'react';
import { ChevronLeft, Bookmark, Share2, Sparkles, Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { triggerHaptic } from '../../services/haptics';

export const LookDetailModal: React.FC = () => {
  const { selectedLook, setFlow, setTab, wearGarment, toggleSaveLook, garments } = useApp();
  const [copiedToast, setCopiedToast] = useState(false);

  if (!selectedLook) return null;

  const handleWearLook = () => {
    triggerHaptic('medium');
    if (selectedLook.garmentIds.length > 0) {
      wearGarment(selectedLook.garmentIds[0]);
    }
    setFlow(null);
    setTab('mirror');
  };

  const handleToggleSave = async () => {
    await toggleSaveLook(selectedLook.id);
  };

  const handleShare = () => {
    triggerHaptic('light');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 2000);
    }
  };

  // Resolve garment pieces from the user's digital wardrobe
  const lookGarments = garments.filter((g) => selectedLook.garmentIds.includes(g.id));

  return (
    <div
      id="modal-look-detail"
      className="fixed inset-0 z-50 bg-[#FBF9F5] flex flex-col justify-between overflow-y-auto no-scrollbar"
    >
      {/* Top Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <button
          type="button"
          id="btn-back-look-detail"
          onClick={() => {
            triggerHaptic('light');
            setFlow(null);
          }}
          className="p-1 -ml-1 text-[#1A1918] hover:text-[#78746D] transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-6 h-6 stroke-[1.5]" />
        </button>
        <span className="text-xs uppercase tracking-widest text-[#78746D] font-medium">
          {selectedLook.occasion}
        </span>
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={handleShare}
            className="p-1.5 text-[#1A1918] hover:text-[#78746D] transition-colors"
            title="Share Look"
          >
            <Share2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleToggleSave}
            className="p-1.5 text-[#1A1918] hover:text-[#78746D] transition-colors"
          >
            <Bookmark
              className={`w-5 h-5 ${
                selectedLook.saved ? 'fill-[#1A1918] text-[#1A1918]' : 'text-[#1A1918]'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="px-6 py-2 flex-1 flex flex-col space-y-5">
        {/* Full-Body Editorial Look Image */}
        <div className="w-full aspect-[3/4] max-h-[440px] rounded-3xl overflow-hidden bg-[#EFECE6] border border-[#E8E4DC] shadow-sm">
          <img
            src={selectedLook.fullBodyImageUrl}
            alt={selectedLook.title}
            className="w-full h-full object-cover object-top"
          />
        </div>

        {/* Look Title & Description */}
        <div>
          <h2 className="font-serif text-3xl text-[#1A1918] font-normal">
            {selectedLook.title}
          </h2>
          {selectedLook.description && (
            <p className="text-xs text-[#78746D] mt-1 leading-relaxed">
              {selectedLook.description}
            </p>
          )}
        </div>

        {/* Breakdown of Garment Pieces from Closet */}
        <div className="space-y-2.5">
          <p className="text-xs uppercase tracking-wider text-[#78746D] font-medium">
            Pieces from your wardrobe ({lookGarments.length})
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            {lookGarments.map((piece) => (
              <div
                key={piece.id}
                className="flex items-center space-x-2.5 p-2 bg-[#EFECE6] rounded-xl border border-[#E8E4DC]"
              >
                <div className="w-10 h-10 rounded-lg bg-white p-1 flex-shrink-0">
                  <img
                    src={piece.cutoutUrl}
                    alt={piece.name}
                    className="w-full h-full object-contain mix-blend-multiply"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#1A1918] truncate">
                    {piece.name}
                  </p>
                  <p className="text-[9px] text-[#78746D] uppercase">{piece.category}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {copiedToast && (
          <div className="p-2 rounded-xl bg-[#1A1918] text-[#FBF9F5] text-xs text-center flex items-center justify-center space-x-1">
            <Check className="w-3.5 h-3.5" />
            <span>Link copied to clipboard</span>
          </div>
        )}
      </div>

      {/* Bottom Sticky Action Bar */}
      <div className="p-5 sticky bottom-0 bg-[#FBF9F5]/95 backdrop-blur-md border-t border-[#E8E4DC]">
        <button
          type="button"
          id="btn-look-wear-this"
          onClick={handleWearLook}
          className="w-full py-3.5 px-6 rounded-xl bg-[#1A1918] text-[#FBF9F5] text-sm font-medium tracking-wide shadow-sm hover:bg-[#2C2B29] active:scale-[0.99] transition-all flex items-center justify-center space-x-2 cursor-pointer"
        >
          <Sparkles className="w-4 h-4 text-amber-100" />
          <span>Wear This in Mirror</span>
        </button>
      </div>
    </div>
  );
};
