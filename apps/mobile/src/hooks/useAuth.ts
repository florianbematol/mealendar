import { supabase } from '@/lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

export type AuthState = {
  session: Session | null;
  loading: boolean;
};

/**
 * Hook qui expose la session Supabase courante.
 * - loading vrai tant qu'on attend la premiere lecture du storage
 * - re-render automatique sur signin / signout / refresh
 */
export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, loading };
}
