import React, { useEffect } from 'react';
import { useApp } from '../../context/AppContext';

export const SplashScreen: React.FC = () => {
  const { setFlow } = useApp();

  useEffect(() => {
    const timer = setTimeout(() => {
      setFlow('welcome');
    }, 1200);
    return () => clearTimeout(timer);
  }, [setFlow]);

  return (
    <div
      id="screen-splash"
      className="fixed inset-0 z-50 bg-[#FBF9F5] flex flex-col items-center justify-center p-8 select-none"
    >
      <div className="flex flex-col items-center text-center animate-fade-in">
        <h1 className="font-serif text-5xl sm:text-6xl text-[#1A1918] tracking-tight mb-3 font-normal">
          mirobe
        </h1>
        <p className="text-xs sm:text-sm text-[#78746D] tracking-widest uppercase font-light">
          your wardrobe, on you.
        </p>

        {/* Small understated loading indication */}
        <div className="mt-16 flex items-center space-x-1.5">
          <div className="w-1.5 h-1.5 bg-[#1A1918]/30 rounded-full animate-pulse" />
          <div className="w-1.5 h-1.5 bg-[#1A1918]/50 rounded-full animate-pulse delay-150" />
          <div className="w-1.5 h-1.5 bg-[#1A1918]/80 rounded-full animate-pulse delay-300" />
        </div>
      </div>
    </div>
  );
};
