import React from 'react';
import { useApp } from '../../context/AppContext';
import { triggerHaptic } from '../../services/haptics';

export const WelcomeScreen: React.FC = () => {
  const { setFlow, setTab } = useApp();

  const handleGetStarted = () => {
    triggerHaptic('medium');
    setFlow('create-mirror');
  };

  const handleExistingAccount = () => {
    triggerHaptic('light');
    setFlow(null);
    setTab('wardrobe');
  };

  return (
    <div
      id="screen-welcome"
      className="relative flex-1 w-full bg-[#FBF9F5] flex flex-col justify-between px-6 pt-6 pb-8 overflow-hidden select-none"
    >
      {/* Top Brand Header */}
      <div className="flex flex-col items-center text-center mt-2">
        <h1 className="font-serif text-4xl sm:text-5xl text-[#1A1918] tracking-tight font-normal">
          mirobe
        </h1>
        <p className="text-xs text-[#78746D] tracking-widest uppercase mt-1 font-medium">
          your wardrobe, on you.
        </p>
      </div>

      {/* Editorial Hero Image (styled after user moodboard screen 01) */}
      <div className="my-6 relative w-full aspect-[4/5] max-h-[460px] rounded-2xl overflow-hidden shadow-[0_12px_36px_rgba(26,25,24,0.08)] bg-[#EFECE6] border border-[#E8E4DC]">
        <img
          src="https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1000&q=85"
          alt="Mirobe Editorial Style"
          className="w-full h-full object-cover object-center"
          loading="eager"
        />
        {/* Soft bottom vignette */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#1A1918]/60 via-transparent to-transparent flex flex-col justify-end p-5">
          <span className="text-[#FBF9F5] font-serif text-lg tracking-wide italic">
            Style a more you.
          </span>
        </div>
      </div>

      {/* Supporting Copy & CTAs */}
      <div className="flex flex-col items-center text-center space-y-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-[#1A1918] tracking-tight">
            Your real clothes. A smarter wardrobe.
          </p>
          <p className="text-xs text-[#78746D]">
            See yourself in anything you already own.
          </p>
        </div>

        <div className="w-full space-y-2.5 pt-1">
          <button
            type="button"
            id="btn-welcome-get-started"
            onClick={handleGetStarted}
            className="w-full py-3.5 px-6 rounded-xl bg-[#1A1918] text-[#FBF9F5] text-sm font-medium tracking-wide shadow-sm hover:bg-[#2C2B29] active:scale-[0.99] transition-all cursor-pointer"
          >
            Get Started
          </button>

          <button
            type="button"
            id="btn-welcome-existing-account"
            onClick={handleExistingAccount}
            className="w-full py-2.5 px-4 text-xs font-normal text-[#78746D] hover:text-[#1A1918] transition-colors cursor-pointer"
          >
            I already have an account
          </button>
        </div>
      </div>
    </div>
  );
};
