import React, { useState } from 'react';
import { Bookmark, Calendar, Filter, Sparkles } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { triggerHaptic } from '../../services/haptics';
import { Look } from '../../types';

export const LooksScreen: React.FC = () => {
  const { looks, openLookDetail, garments, wearGarment, setTab, toggleSaveLook } = useApp();
  const [activeTab, setActiveTab] = useState<'for-you' | 'saved' | 'plan'>('for-you');
  const [activeFilter, setActiveFilter] = useState<string>('All');

  const occasionFilters = ['All', 'Casual', 'Work', 'Date', 'Travel', 'Evening'];

  const filteredLooks = looks.filter((look) => {
    if (activeTab === 'saved' && !look.saved) return false;
    if (activeFilter !== 'All' && look.occasion !== activeFilter) return false;
    return true;
  });

  return (
    <div
      id="screen-looks"
      className="flex-1 w-full bg-[#FBF9F5] px-5 py-3 flex flex-col space-y-4 overflow-y-auto no-scrollbar"
    >
      {/* Top Header */}
      <div className="pt-1">
        <h1 className="font-serif text-3xl text-[#1A1918] font-normal tracking-tight">
          Looks
        </h1>
        <p className="text-xs text-[#78746D] mt-0.5">
          New ways to wear what you have
        </p>
      </div>

      {/* Main Tabs (For You / Saved / Plan) */}
      <div className="flex p-1 bg-[#EFECE6] rounded-xl border border-[#E8E4DC]">
        <button
          type="button"
          onClick={() => {
            triggerHaptic('selection');
            setActiveTab('for-you');
          }}
          className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer ${
            activeTab === 'for-you'
              ? 'bg-[#1A1918] text-[#FBF9F5] shadow-xs'
              : 'text-[#78746D] hover:text-[#1A1918]'
          }`}
        >
          For You
        </button>
        <button
          type="button"
          onClick={() => {
            triggerHaptic('selection');
            setActiveTab('saved');
          }}
          className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer ${
            activeTab === 'saved'
              ? 'bg-[#1A1918] text-[#FBF9F5] shadow-xs'
              : 'text-[#78746D] hover:text-[#1A1918]'
          }`}
        >
          Saved ({looks.filter((l) => l.saved).length})
        </button>
        <button
          type="button"
          onClick={() => {
            triggerHaptic('selection');
            setActiveTab('plan');
          }}
          className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer ${
            activeTab === 'plan'
              ? 'bg-[#1A1918] text-[#FBF9F5] shadow-xs'
              : 'text-[#78746D] hover:text-[#1A1918]'
          }`}
        >
          Planner
        </button>
      </div>

      {/* Occasion Filter Pills */}
      {activeTab !== 'plan' && (
        <div className="flex space-x-2 overflow-x-auto no-scrollbar -mx-5 px-5 select-none">
          {occasionFilters.map((filter) => {
            const isSelected = activeFilter === filter;
            return (
              <button
                key={filter}
                type="button"
                onClick={() => {
                  triggerHaptic('selection');
                  setActiveFilter(filter);
                }}
                className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-[#1A1918] text-[#FBF9F5]'
                    : 'bg-[#EFECE6] text-[#78746D] hover:text-[#1A1918] border border-[#E8E4DC]'
                }`}
              >
                {filter}
              </button>
            );
          })}
        </div>
      )}

      {/* TAB: PLANNER VIEW (Calendar week planner as seen in moodboard Screen 07) */}
      {activeTab === 'plan' ? (
        <div className="space-y-4 pb-6 animate-fade-in">
          <div className="p-4 bg-[#EFECE6] rounded-2xl border border-[#E8E4DC] space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-serif text-lg font-medium text-[#1A1918]">This Week</span>
              <span className="text-xs text-[#78746D]">April 2025</span>
            </div>

            {/* Week row */}
            <div className="grid grid-cols-7 gap-1 text-center text-xs">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, idx) => (
                <div
                  key={idx}
                  className={`py-2 rounded-lg flex flex-col items-center ${
                    idx === 2 ? 'bg-[#1A1918] text-[#FBF9F5]' : 'text-[#68655E]'
                  }`}
                >
                  <span className="text-[10px] uppercase">{day}</span>
                  <span className="font-semibold text-xs mt-0.5">{7 + idx}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Planned Outfits List */}
          <div className="space-y-2.5">
            <div className="p-3 bg-[#EFECE6] rounded-2xl border border-[#E8E4DC] flex items-center space-x-3">
              <div className="w-14 h-16 rounded-xl overflow-hidden bg-white">
                <img
                  src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80"
                  alt="Work Outfit"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-start">
                  <p className="text-xs font-semibold text-[#1A1918]">Work • Office Meeting</p>
                  <span className="text-[10px] text-[#78746D]">Wednesday</span>
                </div>
                <p className="text-[11px] text-[#68655E] mt-0.5">Black Blazer + Beige Trousers</p>
              </div>
            </div>

            <div className="p-3 bg-[#EFECE6] rounded-2xl border border-[#E8E4DC] flex items-center space-x-3">
              <div className="w-14 h-16 rounded-xl overflow-hidden bg-white">
                <img
                  src="https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=400&q=80"
                  alt="Dinner with friends"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-start">
                  <p className="text-xs font-semibold text-[#1A1918]">Dinner • Bistro St. Germain</p>
                  <span className="text-[10px] text-[#78746D]">Friday</span>
                </div>
                <p className="text-[11px] text-[#68655E] mt-0.5">Striped Knit + Raw Denim</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* LOOKS FEED (Displaying actual full body looks + small row of garment thumbnails) */
        <div className="space-y-5 pb-6">
          {filteredLooks.map((look) => {
            const pieceThumbnails = garments.filter((g) => look.garmentIds.includes(g.id));

            return (
              <div
                key={look.id}
                onClick={() => openLookDetail(look)}
                className="group bg-[#EFECE6] rounded-3xl border border-[#E8E4DC] p-3.5 space-y-3 cursor-pointer hover:border-[#1A1918]/30 transition-all shadow-2xs"
              >
                {/* Full Body Look Image */}
                <div className="w-full aspect-[4/5] rounded-2xl overflow-hidden bg-black/5 relative">
                  <img
                    src={look.fullBodyImageUrl}
                    alt={look.title}
                    className="w-full h-full object-cover object-top group-hover:scale-102 transition-transform duration-300"
                  />

                  {/* Bookmark action */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSaveLook(look.id);
                    }}
                    className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/40 backdrop-blur-md text-white flex items-center justify-center hover:bg-black/60 transition-colors"
                  >
                    <Bookmark
                      className={`w-4 h-4 ${
                        look.saved ? 'fill-white text-white' : 'text-white'
                      }`}
                    />
                  </button>

                  <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/40 backdrop-blur-md text-white text-[10px] uppercase font-medium">
                    {look.occasion}
                  </div>
                </div>

                {/* Look Information & Wardrobe Pieces Row */}
                <div className="space-y-2 pt-0.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-[#1A1918]">{look.title}</h3>
                      <p className="text-[10px] text-[#78746D] uppercase">
                        From your wardrobe
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (look.garmentIds[0]) {
                          wearGarment(look.garmentIds[0]);
                          setTab('mirror');
                        }
                      }}
                      className="px-3 py-1.5 rounded-full bg-[#1A1918] text-[#FBF9F5] text-xs font-medium flex items-center space-x-1.5 hover:bg-[#2C2B29] transition-colors"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>Wear</span>
                    </button>
                  </div>

                  {/* Small Row of Garment Thumbnails (as specified in prompt & design) */}
                  <div className="flex space-x-2 pt-1 overflow-x-auto no-scrollbar">
                    {pieceThumbnails.map((piece) => (
                      <div
                        key={piece.id}
                        className="w-11 h-11 rounded-xl bg-white p-1 border border-[#E8E4DC] flex-shrink-0"
                        title={piece.name}
                      >
                        <img
                          src={piece.cutoutUrl}
                          alt={piece.name}
                          className="w-full h-full object-contain mix-blend-multiply"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}

          {filteredLooks.length === 0 && (
            <div className="py-12 text-center text-xs text-[#8C877E]">
              No looks saved in this category yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
