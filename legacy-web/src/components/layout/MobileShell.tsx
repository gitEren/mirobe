import React from 'react';
import { Smartphone, Monitor, Globe } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BottomTabBar } from '../navigation/BottomTabBar';

interface MobileShellProps {
  children: React.ReactNode;
}

export const MobileShell: React.FC<MobileShellProps> = ({ children }) => {
  const { flow, setFlow, deviceType, setDeviceType, language, setLanguage, tab, t } = useApp();

  return (
    <div className="min-h-screen bg-[#141413] text-[#1A1918] flex flex-col items-center justify-center p-0 sm:p-3 lg:p-5 overflow-x-hidden font-sans select-none">
      {/* Top subtle controls for platform simulation & language toggle */}
      <header className="hidden sm:flex items-center justify-between w-full max-w-md mb-2 px-3 text-xs text-[#A39E93]">
        <div className="flex items-center space-x-2">
          <span className="font-serif tracking-widest text-sm text-[#FBF9F5] font-semibold">mirobe</span>
          <span className="text-[#68655E]">•</span>
          <span className="text-[#8C877E] tracking-wider text-[11px] uppercase">
            {deviceType === 'ios' ? 'iOS (iPhone 16 Pro)' : deviceType === 'android' ? 'Android (Pixel)' : 'Native View'}
          </span>
        </div>

        <div className="flex items-center space-x-2.5">
          {/* Language Switcher */}
          <button
            type="button"
            id="btn-switch-language"
            onClick={() => setLanguage(language === 'tr' ? 'en' : 'tr')}
            className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#222120] hover:bg-[#2C2B29] text-[#FBF9F5] text-[11px] border border-[#3A3835] transition-colors cursor-pointer"
            title="Dili Değiştir / Switch Language"
          >
            <Globe className="w-3 h-3 text-[#C8C2B7]" />
            <span className="font-medium">{language.toUpperCase()}</span>
          </button>

          {/* Device Platform Switcher */}
          <div className="flex items-center bg-[#222120] rounded-md p-0.5 border border-[#3A3835]">
            <button
              type="button"
              id="btn-platform-ios"
              onClick={() => setDeviceType('ios')}
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                deviceType === 'ios' ? 'bg-[#1A1918] text-[#FBF9F5]' : 'text-[#8C877E] hover:text-[#C8C2B7]'
              }`}
              title="iOS Mode"
            >
              iOS
            </button>
            <button
              type="button"
              id="btn-platform-android"
              onClick={() => setDeviceType('android')}
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                deviceType === 'android' ? 'bg-[#1A1918] text-[#FBF9F5]' : 'text-[#8C877E] hover:text-[#C8C2B7]'
              }`}
              title="Android Mode"
            >
              Android
            </button>
            <button
              type="button"
              id="btn-platform-fullscreen"
              onClick={() => setDeviceType(deviceType === 'fullscreen' ? 'ios' : 'fullscreen')}
              className={`p-1 rounded text-[10px] transition-colors ${
                deviceType === 'fullscreen' ? 'bg-[#1A1918] text-[#FBF9F5]' : 'text-[#8C877E] hover:text-[#C8C2B7]'
              }`}
              title="Tam Ekran / Mobil"
            >
              {deviceType === 'fullscreen' ? <Smartphone className="w-3 h-3" /> : <Monitor className="w-3 h-3" />}
            </button>
          </div>

          <button
            type="button"
            id="btn-reopen-welcome"
            onClick={() => setFlow('welcome')}
            className="hover:text-[#FBF9F5] transition-colors cursor-pointer text-[11px] underline underline-offset-2"
          >
            {flow === 'welcome' ? 'Intro' : 'Replay Intro'}
          </button>
        </div>
      </header>

      {/* Main Container: Authentically styled iPhone 16 Pro, Android, or Full Width Viewport */}
      {(() => {
        const isDarkScreen = flow === 'scan-closet' || (tab === 'mirror' && !flow);
        return (
          <main
            id="mirobe-app-root"
            className={`w-full transition-all duration-300 relative bg-[#FBF9F5] overflow-hidden flex flex-col ${
              deviceType === 'fullscreen'
                ? 'max-w-2xl min-h-[100dvh] rounded-none'
                : deviceType === 'ios'
                ? 'max-w-[428px] h-[100dvh] sm:h-[min(884px,calc(100vh-36px))] sm:rounded-[44px] sm:shadow-[0_25px_70px_rgba(0,0,0,0.7)] sm:border-[8px] sm:border-[#282725] sm:ring-1 sm:ring-[#44423E]'
                : 'max-w-[420px] h-[100dvh] sm:h-[min(880px,calc(100vh-36px))] sm:rounded-[36px] sm:shadow-[0_25px_70px_rgba(0,0,0,0.7)] sm:border-[7px] sm:border-[#2D2D2B] sm:ring-1 sm:ring-[#44423E]'
            }`}
          >
            {/* Mobile Status Bar */}
            <div
              className={`w-full pt-2.5 px-6 flex items-center justify-between z-30 select-none pointer-events-none transition-colors ${
                isDarkScreen ? 'text-white' : 'text-[#1A1918]'
              }`}
            >
              <span className="text-xs font-semibold tracking-tight">
                {deviceType === 'android' ? '09:41' : '9:41'}
              </span>

              {/* iOS Dynamic Island vs Android Punch-Hole Camera */}
              {deviceType === 'ios' ? (
                <div className="hidden sm:block w-26 h-5 bg-[#1A1918] rounded-full mx-auto" />
              ) : deviceType === 'android' ? (
                <div className="hidden sm:block w-3.5 h-3.5 bg-[#1A1918] rounded-full mx-auto" />
              ) : null}

              <div className="flex items-center space-x-1.5 text-xs">
                {/* Cellular */}
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M2 17h2v4H2v-4zm5-4h2v8H7v-8zm5-5h2v13h-2V8zm5-5h2v18h-2V3z" />
                </svg>
                {/* Wifi */}
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M12 4C7.31 4 3.07 5.9 0 8.98L12 21 24 8.98C20.93 5.9 16.69 4 12 4zm0 2.2c3.95 0 7.54 1.5 10.27 3.97L12 18.78 1.73 10.17C4.46 7.7 8.05 6.2 12 6.2z" />
                </svg>
                {/* Battery */}
                <div className="w-5 h-2.5 border border-current rounded-sm p-0.5 flex items-center">
                  <div className="h-full w-full bg-current rounded-2xs" />
                </div>
              </div>
            </div>

            {/* Screen Viewport */}
            <div className="flex-1 min-h-0 w-full relative overflow-y-auto no-scrollbar flex flex-col">
              {children}
            </div>

            {/* Bottom Navigation */}
            <BottomTabBar />

            {/* iOS Home Indicator or Android Navigation Bar */}
            <div className="w-full flex justify-center py-1.5 pointer-events-none bg-transparent">
              {deviceType === 'android' ? (
                <div
                  className={`w-20 h-1 rounded-full transition-colors ${
                    isDarkScreen ? 'bg-white/40' : 'bg-[#1A1918]/30'
                  }`}
                />
              ) : (
                <div
                  className={`w-32 h-1 rounded-full transition-colors ${
                    isDarkScreen ? 'bg-white/40' : 'bg-[#1A1918]/25'
                  }`}
                />
              )}
            </div>
          </main>
        );
      })()}
    </div>
  );
};
