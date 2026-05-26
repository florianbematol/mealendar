-- Mealendar - Migration Phase 3 : LLM rate limiting + audit
--
-- Le cache des reponses LLM est entierement en Cloudflare KV (pas en DB).
-- On track ici uniquement les usages par utilisateur pour le rate limiting.

create table if not exists public.llm_usages (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  household_id    uuid references public.households(id) on delete set null,
  kind            text not null check (kind in ('recipe', 'planning')),
  model           text,
  prompt_hash     text,
  cache_hit       boolean not null default false,
  tokens_in       int,
  tokens_out      int,
  created_at      timestamptz not null default now()
);

create index if not exists llm_usages_user_recent_idx
  on public.llm_usages (user_id, created_at desc);

alter table public.llm_usages enable row level security;

drop policy if exists "llm_usages_select_own" on public.llm_usages;
create policy "llm_usages_select_own"
  on public.llm_usages for select
  to authenticated
  using (user_id = auth.uid());

-- ============================================================================
-- RPC : count_llm_usage_since (compteur pour rate limiting)
--   Retourne le nombre d'appels LLM (cache_hit = false) du user dans une fenetre.
-- ============================================================================
create or replace function public.count_llm_usage_since(
  p_since timestamptz
)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from public.llm_usages
   where user_id = auth.uid()
     and cache_hit = false
     and created_at >= p_since;
$$;

revoke all on function public.count_llm_usage_since(timestamptz) from public;
grant execute on function public.count_llm_usage_since(timestamptz) to authenticated;

-- ============================================================================
-- RPC : record_llm_usage (insert via SECURITY DEFINER, evite RLS sur INSERT)
-- ============================================================================
create or replace function public.record_llm_usage(
  p_household_id uuid,
  p_kind text,
  p_model text,
  p_prompt_hash text,
  p_cache_hit boolean,
  p_tokens_in int default null,
  p_tokens_out int default null
)
returns public.llm_usages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.llm_usages%rowtype;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  insert into public.llm_usages(
    user_id, household_id, kind, model, prompt_hash, cache_hit, tokens_in, tokens_out
  )
  values (
    v_user, p_household_id, p_kind, p_model, p_prompt_hash, p_cache_hit, p_tokens_in, p_tokens_out
  )
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.record_llm_usage(uuid, text, text, text, boolean, int, int) from public;
grant execute on function public.record_llm_usage(uuid, text, text, text, boolean, int, int) to authenticated;
