-- Mealendar - Migration : push notifications (Phase 5.4)
--
-- Table device_tokens : 1 ligne par device-utilisateur. Le user peut avoir
-- plusieurs tokens (un par device : phone, tablet). Au logout on supprime
-- le token du device courant. Au refresh d'un token Expo, on update.
--
-- expo_push_token : "ExponentPushToken[xxxxxxxxxxxxxxxxx]"
-- platform : 'ios' | 'android' (web non supporte par Expo Push)
-- enabled : flag user-controlled pour desactiver les notifs sans desinstaller

create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null,
  platform text not null check (platform in ('ios', 'android')),
  enabled boolean not null default true,
  /** Filet de securite : on disable un token si Expo nous le marque comme invalide. */
  invalid_at timestamptz,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, expo_push_token)
);

create index if not exists device_tokens_user_idx on public.device_tokens(user_id);
create index if not exists device_tokens_token_idx on public.device_tokens(expo_push_token);

alter table public.device_tokens enable row level security;

-- RLS : un user gere ses propres tokens uniquement
drop policy if exists device_tokens_select_own on public.device_tokens;
create policy device_tokens_select_own on public.device_tokens
  for select using (user_id = auth.uid());

drop policy if exists device_tokens_insert_own on public.device_tokens;
create policy device_tokens_insert_own on public.device_tokens
  for insert with check (user_id = auth.uid());

drop policy if exists device_tokens_update_own on public.device_tokens;
create policy device_tokens_update_own on public.device_tokens
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists device_tokens_delete_own on public.device_tokens;
create policy device_tokens_delete_own on public.device_tokens
  for delete using (user_id = auth.uid());

-- ============================================================================
-- RPC register_push_token : upsert (user, token) -> active + last_used = now()
-- ============================================================================
create or replace function public.register_push_token(
  p_token text,
  p_platform text
)
returns public.device_tokens
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.device_tokens%rowtype;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_platform not in ('ios', 'android') then
    raise exception 'Invalid platform: %', p_platform using errcode = '22023';
  end if;

  insert into public.device_tokens(user_id, expo_push_token, platform)
  values (v_user, p_token, p_platform)
  on conflict (user_id, expo_push_token) do update set
    enabled = true,
    invalid_at = null,
    last_used_at = now(),
    platform = excluded.platform
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.register_push_token(text, text) from public;
grant execute on function public.register_push_token(text, text) to authenticated;

-- ============================================================================
-- RPC unregister_push_token : delete pour ce user uniquement
-- ============================================================================
create or replace function public.unregister_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  delete from public.device_tokens
   where user_id = v_user and expo_push_token = p_token;
end;
$$;

revoke all on function public.unregister_push_token(text) from public;
grant execute on function public.unregister_push_token(text) to authenticated;

-- ============================================================================
-- RPC set_push_notifications_enabled : active/desactive tous les tokens du user
-- ============================================================================
create or replace function public.set_push_notifications_enabled(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  update public.device_tokens
     set enabled = p_enabled
   where user_id = v_user;
end;
$$;

revoke all on function public.set_push_notifications_enabled(boolean) from public;
grant execute on function public.set_push_notifications_enabled(boolean) to authenticated;
