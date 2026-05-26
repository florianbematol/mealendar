import 'react-native-url-polyfill/auto';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

/**
 * Adapter de stockage pour Supabase Auth.
 *
 * - Sur native (iOS/Android), on utilise expo-secure-store (Keychain / Keystore).
 *   Limite : 2 KB par cle, ce qui suffit largement pour un JWT Supabase.
 * - Sur web, on retombe sur localStorage via le default de Supabase.
 */
const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

/**
 * Le client Supabase. Cree paresseusement uniquement si la config est valide,
 * pour eviter un crash brutal si .env.local manque - on prefere afficher
 * un ecran d'erreur clair via isSupabaseConfigured().
 */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

function makeStubClient(): SupabaseClient {
  // Client minimal qui rejette toute operation avec un message clair.
  // Permet a l'app de demarrer pour afficher l'ecran d'erreur de config.
  const error = new Error(
    "Supabase n'est pas configure. Creer apps/mobile/.env.local avec EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY, puis redemarrer Metro.",
  );
  const reject = async () => {
    throw error;
  };
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithPassword: reject,
      signUp: reject,
      signOut: reject,
    },
    from: () => ({ select: reject, insert: reject, update: reject, delete: reject }),
    rpc: reject,
    // biome-ignore lint/suspicious/noExplicitAny: stub client utilise uniquement quand la config manque
  } as any;
}

export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: Platform.OS === 'web' ? undefined : ExpoSecureStoreAdapter,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : makeStubClient();
