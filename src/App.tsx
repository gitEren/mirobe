import React from 'react';
import { MobileShell } from './components/layout/MobileShell';
import { CreateMirrorScreen } from './components/screens/CreateMirrorScreen';
import { GarmentDetailModal } from './components/screens/GarmentDetailModal';
import { HomeScreen } from './components/screens/HomeScreen';
import { LookDetailModal } from './components/screens/LookDetailModal';
import { LooksScreen } from './components/screens/LooksScreen';
import { MirrorScreen } from './components/screens/MirrorScreen';
import { ProfileScreen } from './components/screens/ProfileScreen';
import { ReviewScanScreen } from './components/screens/ReviewScanScreen';
import { ScanClosetScreen } from './components/screens/ScanClosetScreen';
import { ScanningProgressScreen } from './components/screens/ScanningProgressScreen';
import { SplashScreen } from './components/screens/SplashScreen';
import { StylistScreen } from './components/screens/StylistScreen';
import { WardrobeScreen } from './components/screens/WardrobeScreen';
import { WelcomeScreen } from './components/screens/WelcomeScreen';
import { AppProvider, useApp } from './context/AppContext';

const AppContent: React.FC = () => {
  const { flow, tab } = useApp();

  return (
    <MobileShell>
      {/* Full-screen Flows and Modals */}
      {flow === 'splash' && <SplashScreen />}
      {flow === 'welcome' && <WelcomeScreen />}
      {flow === 'create-mirror' && <CreateMirrorScreen />}
      {flow === 'scan-closet' && <ScanClosetScreen />}
      {flow === 'scanning' && <ScanningProgressScreen />}
      {flow === 'review-scan' && <ReviewScanScreen />}
      {flow === 'garment-detail' && <GarmentDetailModal />}
      {flow === 'look-detail' && <LookDetailModal />}

      {/* Main Tab Screens when not in a modal flow */}
      {flow === null && (
        <>
          {tab === 'home' && <HomeScreen />}
          {tab === 'wardrobe' && <WardrobeScreen />}
          {tab === 'mirror' && <MirrorScreen />}
          {tab === 'looks' && <LooksScreen />}
          {tab === 'stylist' && <StylistScreen />}
          {tab === 'profile' && <ProfileScreen />}
        </>
      )}
    </MobileShell>
  );
};

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
