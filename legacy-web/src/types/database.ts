/**
 * Supabase / PostgreSQL Typed Models
 * Matches the Mirobe production database schema.
 */

export interface DbUser {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  created_at: string;
}

export interface DbMirrorProfile {
  id: string;
  user_id: string;
  photo_url: string;
  aspect_ratio: string;
  height?: string;
  body_type?: string;
  version: string;
  created_at: string;
}

export interface DbGarment {
  id: string;
  user_id: string;
  name: string;
  category: 'top' | 'bottom' | 'outerwear' | 'dress' | 'shoes' | 'accessory';
  subcategory?: string;
  colors: string[];
  pattern?: string;
  material?: string;
  style_tags: string[];
  image_url: string;
  cutout_url?: string;
  worn_count: number;
  last_worn_at?: string;
  created_at: string;
}

export interface DbGarmentImage {
  id: string;
  garment_id: string;
  storage_path: string;
  is_primary: boolean;
  cutout_path?: string;
  created_at: string;
}

export interface DbWardrobeScan {
  id: string;
  user_id: string;
  source_image_urls: string[];
  detected_count: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
}

export interface DbLook {
  id: string;
  user_id: string;
  title: string;
  occasion: string;
  full_body_image_url: string;
  is_saved: boolean;
  created_at: string;
}

export interface DbLookItem {
  id: string;
  look_id: string;
  garment_id: string;
  layer_order: number;
}

export interface DbTryOnRender {
  id: string;
  user_id: string;
  mirror_profile_id: string;
  garment_ids: string[];
  preview_url?: string;
  final_url?: string;
  provider?: string;
  status: 'queued' | 'processing' | 'ready' | 'failed';
  cache_key: string;
  created_at: string;
}

export interface DbStylistConversation {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
}

export interface DbStylistMessage {
  id: string;
  conversation_id: string;
  sender: 'user' | 'mirobe';
  message: string;
  outfit_preview_url?: string;
  garment_ids?: string[];
  created_at: string;
}

export interface DbFavorite {
  id: string;
  user_id: string;
  entity_type: 'garment' | 'look';
  entity_id: string;
  created_at: string;
}
