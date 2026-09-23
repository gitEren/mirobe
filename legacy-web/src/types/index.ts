export type GarmentCategory =
  | 'top'
  | 'bottom'
  | 'outerwear'
  | 'dress'
  | 'shoes'
  | 'accessory';

export interface Garment {
  id: string;
  userId: string;
  name: string;
  category: GarmentCategory;
  subcategory?: string;
  colors: string[];
  pattern?: string;
  material?: string;
  styleTags: string[];
  occasions: string[]; // e.g. ['pub', 'bar', 'gece', 'ofis', 'date', 'casual', 'party']
  imageUrl: string;
  cutoutUrl: string;
  createdAt: string;
  wornCount?: number;
  lastWorn?: string;
  favorite?: boolean;
  originalImageUrl?: string;
  scanSource?: 'wearing' | 'hanger' | 'gallery' | 'demo';
  confidence?: number;
  studioUrl?: string;
  maskUrl?: string;
  qualityStatus?: 'processing' | 'ready' | 'rejected';
  renderer?: string;
  rendererModel?: string;
  promptVersion?: string;
}

export type LiveMirrorStatus =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'fallback'
  | 'stopping'
  | 'error';

export interface LiveMirrorState {
  status: LiveMirrorStatus;
  provider: 'fal-lucy2' | 'local-overlay' | 'last-success' | 'none';
  remainingSeconds: number;
  sessionSeconds: number;
  maxSessionSeconds: number;
  selectedGarmentIds: string[];
  message?: string;
}

export interface JevDecision {
  topGarmentId?: string;
  outerwearGarmentId?: string;
  bottomGarmentId?: string;
  shoesGarmentId?: string;
  accessoryGarmentId?: string;
  occasion: string;
  style: string;
  confidence: number;
  explanation?: string;
}

export interface MirrorProfile {
  id: string;
  userId: string;
  name: string;
  photoUrl: string;
  aspectRatio: string;
  height?: string;
  bodyType?: string;
  version: string;
  createdAt: string;
}

export interface TryOnRequest {
  personImageId: string;
  garmentIds: string[];
  currentLookId?: string;
  quality: 'preview' | 'final';
}

export interface TryOnResult {
  id: string;
  status: 'queued' | 'processing' | 'ready' | 'failed';
  previewUrl?: string;
  finalUrl?: string;
  cached: boolean;
  garmentIds: string[];
  wearingDescription: string;
  provider?: string;
  providerCostUsd?: number;
}

export interface PhotoTryOnResult {
  id: string;
  status: 'ready' | 'failed';
  imageUrl?: string;
  cached: boolean;
  garmentIds: string[];
  provider: string;
  providerCostUsd?: number;
  error?: string;
}

export interface UsageSnapshot {
  planId: 'free' | 'premium' | 'pro';
  photoTokensUsed: number;
  photoTokensLimit: number;
  jevDecisionsUsed: number;
  jevDecisionsLimit: number;
  videoSecondsUsed: number;
  videoSecondsLimit: number;
}

export interface Look {
  id: string;
  userId: string;
  title: string;
  occasion: 'Casual' | 'Work' | 'Date' | 'Travel' | 'Evening';
  garmentIds: string[];
  fullBodyImageUrl: string;
  saved: boolean;
  createdAt: string;
  description?: string;
}

export interface StylistMessage {
  id: string;
  sender: 'user' | 'mirobe';
  text: string;
  outfitPreviewUrl?: string;
  garmentIds?: string[];
  lookTitle?: string;
  suggestedPrompt?: string;
  createdAt: string;
}

export type TabType = 'home' | 'wardrobe' | 'mirror' | 'looks' | 'stylist' | 'profile';

export type FlowType =
  | 'splash'
  | 'welcome'
  | 'create-mirror'
  | 'scan-closet'
  | 'scanning'
  | 'review-scan'
  | 'garment-detail'
  | 'look-detail'
  | null;
