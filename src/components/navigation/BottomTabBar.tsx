import React from 'react';
import { Compass, Grid3X3, Sparkles, User, Camera } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { TabType } from '../../types';

export const BottomTabBar: React.FC = () => {
  const { tab, setTab, flow, t } = useApp();
  const isMirrorTabActive = tab === 'mirror';

  // If a full-screen flow is open (like scanning or welcome), hide bottom bar
  if (flow === 'welcome' || flow === 'scanning' || flow === 'create-mirror' || flow === 'scan-closet' || tab === 'mirror') {
    return null;
  }

  const navItems: { id: TabType; label: string; icon: React.ReactNode }[] = [
    {
      id: 'home',
      label: t.tabs.home,
      icon: <Compass className="w-5 h-5 stroke-[1.6]" />,
    },
    {
      id: 'wardrobe',
      label: t.tabs.wardrobe,
      icon: <Grid3X3 className="w-5 h-5 stroke-[1.6]" />,
    },
    {
      id: 'mirror',
      label: t.tabs.mirror,
      icon: (
        <div className="relative flex items-center justify-center">
          <div
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-300 ${
              isMirrorTabActive
                ? 'bg-[#1A1918] text-[#FBF9F5] shadow-lg scale-105 ring-2 ring-[#1A1918]/20 ring-offset-2 ring-offset-[#FBF9F5]'
                : 'bg-[#EFECE6] text-[#1A1918] hover:bg-[#E6E1D7]'
            }`}
          >
            <Camera className="w-4.5 h-4.5 stroke-[1.9]" />
          </div>
          {/* Subtle live indicator dot */}
          <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
        </div>
      ),
    },
    {
      id: 'looks',
      label: t.tabs.looks,
      icon: (
        <svg
          className="w-5 h-5 stroke-[1.6]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
          />
        </svg>
      ),
    },
    {
      id: 'profile',
      label: t.tabs.profile,
      icon: <User className="w-5 h-5 stroke-[1.6]" />,
    },
  ];

  return (
    <nav
      id="mirobe-bottom-navigation"
      aria-label="Main Navigation"
      className="sticky bottom-0 z-40 w-full bg-[#FBF9F5]/92 backdrop-blur-md border-t border-[#E8E4DC] px-4 pt-1.5 pb-4 select-none"
    >
      <div className="max-w-md mx-auto flex items-center justify-around">
        {navItems.map((item) => {
          const isActive = tab === item.id;
          const isMirror = item.id === 'mirror';

          return (
            <button
              key={item.id}
              id={`nav-tab-${item.id}`}
              type="button"
              onClick={() => setTab(item.id)}
              className={`group flex flex-col items-center justify-center transition-transform active:scale-95 cursor-pointer ${
                isMirror ? '-mt-3.5 px-2' : 'flex-1 py-1'
              }`}
            >
              <div
                className={`transition-colors duration-200 ${
                  isActive ? 'text-[#1A1918]' : 'text-[#8C877E] group-hover:text-[#1A1918]'
                }`}
              >
                {item.icon}
              </div>
              <span
                className={`text-[10px] tracking-wide mt-1 font-medium transition-colors duration-200 ${
                  isActive ? 'text-[#1A1918] font-semibold' : 'text-[#8C877E]'
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
