import React, { useState } from 'react';
import { Check, ChevronLeft, Trash2, Edit2, Sparkles } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { triggerHaptic } from '../../services/haptics';
import { GarmentCategory } from '../../types';

export const ReviewScanScreen: React.FC = () => {
  const { pendingDetectedGarments, finishScanReview, setFlow, t } = useApp();
  const [items, setItems] = useState(pendingDetectedGarments);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const categories: { id: GarmentCategory; label: string }[] = [
    { id: 'top', label: t.wardrobe.categories.top },
    { id: 'bottom', label: t.wardrobe.categories.bottom },
    { id: 'outerwear', label: t.wardrobe.categories.outerwear },
    { id: 'dress', label: t.wardrobe.categories.dress },
    { id: 'shoes', label: t.wardrobe.categories.shoes },
    { id: 'accessory', label: t.wardrobe.categories.accessory },
  ];

  const handleRemove = (index: number) => {
    triggerHaptic('light');
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateName = (index: number, newName: string) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, name: newName } : item))
    );
  };

  const handleUpdateCategory = (index: number, newCat: GarmentCategory) => {
    triggerHaptic('selection');
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, category: newCat } : item))
    );
  };

  const handleConfirmAll = async () => {
    if (items.some((item) => item.qualityStatus === 'rejected')) return;
    triggerHaptic('success');
    await finishScanReview(items);
  };

  return (
    <div
      id="screen-review-scan"
      className="flex-1 w-full bg-[#FBF9F5] flex flex-col justify-between px-5 py-4 overflow-y-auto no-scrollbar"
    >
      {/* Top Header */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <button
            type="button"
            id="btn-back-review-scan"
            onClick={() => {
              triggerHaptic('light');
              setFlow('scan-closet');
            }}
            className="p-1 -ml-1 text-[#1A1918] hover:text-[#78746D] transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-6 h-6 stroke-[1.5]" />
          </button>
          <span className="text-xs tracking-widest uppercase text-[#78746D] font-medium">
            {t.scan.reviewTitle}
          </span>
          <div className="w-6" />
        </div>

        <div className="mb-4">
          <h2 className="font-serif text-2xl sm:text-3xl text-[#1A1918] font-normal">
            {t.scan.reviewTitle}
          </h2>
          <p className="text-xs text-[#78746D] mt-1 leading-relaxed">
            {t.scan.reviewSubtitle}
          </p>
        </div>
      </div>

      {/* Grid of Extracted Pieces */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 my-2">
        {items.map((item, index) => (
          <div
            key={index}
            className="p-3.5 bg-[#EFECE6] rounded-2xl border border-[#E8E4DC] relative flex flex-col justify-between"
          >
            {/* Delete piece button */}
            <button
              type="button"
              onClick={() => handleRemove(index)}
              className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-white/80 hover:bg-white text-[#78746D] hover:text-red-600 flex items-center justify-center transition-colors cursor-pointer z-10"
              title="Kaldır"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            {/* Clean product cutout image frame */}
            <div className="w-full aspect-[4/3] rounded-xl bg-white flex items-center justify-center p-3 mb-2.5 shadow-xs relative">
              <img
                src={item.studioUrl || item.imageUrl || item.cutoutUrl}
                alt={item.name}
                className="w-full h-full object-contain"
              />
              <span className="absolute bottom-1.5 left-2 text-[9px] font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                {item.qualityStatus === 'ready' ? 'AI obje hazır ✓' : 'Yerel obje hazır ✓'} {item.confidence ? `${Math.round(item.confidence * 100)}%` : ''}
              </span>
            </div>

            {/* Editable Name & Category */}
            <div className="space-y-2">
              {editingIndex === index ? (
                <input
                  type="text"
                  value={item.name}
                  onChange={(e) => handleUpdateName(index, e.target.value)}
                  onBlur={() => setEditingIndex(null)}
                  autoFocus
                  className="w-full text-xs font-semibold text-[#1A1918] bg-white border border-[#D5D0C6] rounded px-2 py-1"
                />
              ) : (
                <div
                  onClick={() => setEditingIndex(index)}
                  className="flex items-center justify-between group cursor-pointer"
                >
                  <p className="text-xs font-semibold text-[#1A1918] truncate pr-1">
                    {item.name}
                  </p>
                  <Edit2 className="w-3.5 h-3.5 text-[#A39E93] group-hover:text-[#1A1918]" />
                </div>
              )}

              {/* Category Dropdown */}
              <div className="flex items-center justify-between pt-0.5">
                <select
                  value={item.category}
                  onChange={(e) => handleUpdateCategory(index, e.target.value as GarmentCategory)}
                  aria-label={`Category for ${item.name}`}
                  className="text-[11px] font-medium text-[#1A1918] bg-white border border-[#E8E4DC] rounded-lg px-2 py-1 cursor-pointer hover:border-[#D5D0C6] transition-colors"
                >
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.label}
                    </option>
                  ))}
                </select>

                <span className="text-[10px] text-[#78746D]">
                  {item.material || 'Doğal Kumaş'}
                </span>
              </div>

              {/* Occasions / Mekan Etiketleri (for Jev Stylist matching like 'pub') */}
              <div className="pt-2 border-t border-[#E0DBD1] space-y-1.5">
                <div className="flex items-center justify-between text-[10px] text-[#78746D]">
                  <span className="font-medium">Mekan & Stil Etiketleri (Jev İçin):</span>
                  <span className="text-[9px] text-amber-800 font-mono">Pub, Gece, Ofis vb.</span>
                </div>

                {/* Active tags */}
                <div className="flex flex-wrap gap-1">
                  {(item.occasions || ['günlük', 'casual']).map((occ, oIdx) => (
                    <span
                      key={oIdx}
                      className="inline-flex items-center space-x-1 text-[10px] bg-[#1A1918] text-[#FBF9F5] px-2 py-0.5 rounded-md font-medium"
                    >
                      <span>#{occ}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const updatedOcc = (item.occasions || ['günlük']).filter((_, i) => i !== oIdx);
                          setItems((prev) =>
                            prev.map((it, i) => (i === index ? { ...it, occasions: updatedOcc } : it))
                          );
                        }}
                        className="text-white/60 hover:text-white cursor-pointer ml-0.5"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>

                {/* Quick Add Suggestions */}
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {['pub', 'bar', 'gece', 'ofis', 'date', 'kahve', 'hafta sonu']
                    .filter((s) => !(item.occasions || []).includes(s))
                    .map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => {
                          triggerHaptic('selection');
                          const curr = item.occasions || ['günlük'];
                          setItems((prev) =>
                            prev.map((it, i) =>
                              i === index ? { ...it, occasions: [...curr, suggestion] } : it
                            )
                          );
                        }}
                        className="text-[9px] bg-white hover:bg-[#FAF8F5] text-[#55514B] border border-[#D5D0C6] px-1.5 py-0.5 rounded hover:border-[#1A1918] transition-colors cursor-pointer"
                      >
                        +{suggestion}
                      </button>
                    ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Confirmation & Try-On Button */}
      <div className="pt-4 sticky bottom-0 bg-[#FBF9F5]/90 backdrop-blur-md pb-1">
        <button
          type="button"
          id="btn-confirm-all-scanned"
          onClick={handleConfirmAll}
          disabled={items.length === 0 || items.some((item) => item.qualityStatus === 'rejected')}
          className="w-full py-3.5 px-6 rounded-xl bg-[#1A1918] text-[#FBF9F5] text-sm font-medium tracking-wide shadow-md hover:bg-[#2C2B29] active:scale-[0.99] transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Sparkles className="w-4 h-4 text-amber-300" />
          <span>{items.some((item) => item.qualityStatus === 'rejected') ? 'Çıktı uygun değil · Yeniden Tara' : `${items.length} Parçayı Ekle & Canlı Aynada Dene`}</span>
        </button>
      </div>
    </div>
  );
};
