import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import type { Bindings } from '../index';

/**
 * Client Supabase service-role (bypass RLS) cote Worker.
 * A utiliser pour les operations admin / triggers / cas ou RLS ne suffit pas.
 * Pour les operations utilisateur, preferer un client par-requete avec le JWT du user.
 */
export function getServiceClient(env: Bindings): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY non defini');
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Client Supabase pour le compte d'un utilisateur, en presentant son JWT.
 * RLS Postgres applique normalement les policies (auth.uid() = user_id, etc.).
 *
 * Note importante : on passe le JWT a la fois en `Authorization` ET en `apikey`
 * pour que PostgREST le considere comme rôle "authenticated" (et non "anon").
 * Avec la signature ES256 moderne, c'est le `Authorization` qui pilote auth.uid()
 * cote Postgres ; mais le SDK ajoute systematiquement `apikey: anon` ce qui peut
 * causer des conflits de cache. On force donc l'`apikey` a etre le JWT user aussi
 * pour eviter toute ambiguite.
 */
export function getUserClient(env: Bindings, accessToken: string): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error('SUPABASE_URL ou SUPABASE_ANON_KEY non defini');
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: env.SUPABASE_ANON_KEY,
      },
    },
  });
}
