import Constants from 'expo-constants';

/**
 * URL du backend Mealendar (Hono Cloudflare Worker).
 *
 * Ordre de resolution :
 *  1. EXPO_PUBLIC_API_URL si definie (build time, ou .env.local)
 *  2. extra.apiBaseUrl depuis app.json
 *  3. En dev sur device reel : on derive l'IP du PC depuis le hostname Metro
 *     (Expo expose l'IP du serveur de dev via debuggerHost / hostUri)
 *  4. Fallback : http://localhost:8787 (utile sur emulateur/web uniquement)
 */
function resolveApiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv;

  const fromExtra = Constants?.expoConfig?.extra?.apiBaseUrl as string | undefined;
  if (fromExtra && fromExtra !== 'http://localhost:8787') return fromExtra;

  const hostUri =
    (Constants?.expoConfig?.hostUri as string | undefined) ??
    (Constants?.expoGoConfig?.debuggerHost as string | undefined);
  if (hostUri) {
    const host = hostUri.split(':')[0];
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return `http://${host}:8787`;
    }
  }

  return fromExtra ?? 'http://localhost:8787';
}

export const API_BASE_URL = resolveApiBaseUrl();

/**
 * Supabase config (cle anon, publique par design).
 * Utiliser EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY
 * dans .env.local OU les definir dans app.json -> extra.
 */
export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  (Constants?.expoConfig?.extra?.supabaseUrl as string | undefined) ??
  '';

export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  (Constants?.expoConfig?.extra?.supabaseAnonKey as string | undefined) ??
  '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    '[mealendar] SUPABASE_URL ou SUPABASE_ANON_KEY non definie. ' +
      'Renseigner via .env.local (EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY) ou app.json -> extra.',
  );
}
