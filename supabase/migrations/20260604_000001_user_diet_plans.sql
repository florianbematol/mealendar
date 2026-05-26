-- Mealendar - Migration Phase 5.5 : profil dietetique par membre
--
-- Chaque user authentifie a son propre diet plan + regimes + allergies + goals,
-- scope a un foyer. Au moment de generer un planning ou une recette, on agrege
-- les diet plans des membres presents (par slot) pour construire les contraintes.
--
-- meal_plans.diet_plan est conserve provisoirement comme deprecated mais
-- les nouveaux flux n'y ecrivent plus. Une migration de transition copie
-- l'ancien diet_plan vers le owner du foyer s'il existe.

-- ============================================================================
-- Table user_diet_plans : 1 ligne par (user, household)
-- ============================================================================

create table if not exists public.user_diet_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  /** structure DietPlan (slots: { slotKey: DietComponent[] }, dailyRules, note) */
  diet_plan jsonb not null default '{"slots":{},"dailyRules":[],"note":null}'::jsonb,
  /** ex ['vegetarian','gluten_free'] */
  regimes text[] not null default '{}',
  /** ex ['arachide','lactose'] */
  allergies text[] not null default '{}',
  /** ex ['weight_loss','muscle_gain','maintenance'] */
  goals text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, household_id)
);

create index if not exists user_diet_plans_household_idx
  on public.user_diet_plans (household_id);
create index if not exists user_diet_plans_user_idx
  on public.user_diet_plans (user_id);

alter table public.user_diet_plans enable row level security;

-- Membres du foyer : SELECT
drop policy if exists user_diet_plans_select on public.user_diet_plans;
create policy user_diet_plans_select on public.user_diet_plans
  for select using (public.is_household_member(household_id));

-- Insert/update : seulement son propre user_id (et il faut etre membre du foyer)
drop policy if exists user_diet_plans_insert_own on public.user_diet_plans;
create policy user_diet_plans_insert_own on public.user_diet_plans
  for insert with check (
    user_id = auth.uid()
    and public.is_household_member(household_id)
  );

drop policy if exists user_diet_plans_update_own on public.user_diet_plans;
create policy user_diet_plans_update_own on public.user_diet_plans
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists user_diet_plans_delete_own on public.user_diet_plans;
create policy user_diet_plans_delete_own on public.user_diet_plans
  for delete using (user_id = auth.uid());

-- ============================================================================
-- Trigger updated_at
-- ============================================================================
create or replace function public.user_diet_plans_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_diet_plans_set_updated_at on public.user_diet_plans;
create trigger user_diet_plans_set_updated_at
  before update on public.user_diet_plans
  for each row execute function public.user_diet_plans_touch_updated_at();

-- ============================================================================
-- RPC upsert_user_diet_plan : creer ou mettre a jour son propre profil
-- ============================================================================
create or replace function public.upsert_user_diet_plan(
  p_household_id uuid,
  p_diet_plan jsonb,
  p_regimes text[] default '{}',
  p_allergies text[] default '{}',
  p_goals text[] default '{}'
)
returns public.user_diet_plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.user_diet_plans%rowtype;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_household_member(p_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  insert into public.user_diet_plans (user_id, household_id, diet_plan, regimes, allergies, goals)
  values (v_user, p_household_id, p_diet_plan, p_regimes, p_allergies, p_goals)
  on conflict (user_id, household_id) do update set
    diet_plan = excluded.diet_plan,
    regimes = excluded.regimes,
    allergies = excluded.allergies,
    goals = excluded.goals
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.upsert_user_diet_plan(uuid, jsonb, text[], text[], text[]) from public;
grant execute on function public.upsert_user_diet_plan(uuid, jsonb, text[], text[], text[]) to authenticated;

-- ============================================================================
-- RPC get_my_diet_plan : retourne le profil du user courant pour un foyer
-- ============================================================================
create or replace function public.get_my_diet_plan(p_household_id uuid)
returns public.user_diet_plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.user_diet_plans%rowtype;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_household_member(p_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  select * into v_row
  from public.user_diet_plans
  where user_id = v_user and household_id = p_household_id;

  return v_row;
end;
$$;

revoke all on function public.get_my_diet_plan(uuid) from public;
grant execute on function public.get_my_diet_plan(uuid) to authenticated;

-- ============================================================================
-- RPC list_household_diet_plans : retourne tous les profils du foyer (members
-- + email pour affichage). Lecture seule.
-- ============================================================================
create or replace function public.list_household_diet_plans(p_household_id uuid)
returns table (
  id uuid,
  user_id uuid,
  user_email text,
  household_id uuid,
  diet_plan jsonb,
  regimes text[],
  allergies text[],
  goals text[],
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_household_member(p_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  return query
  select
    udp.id,
    udp.user_id,
    u.email::text as user_email,
    udp.household_id,
    udp.diet_plan,
    udp.regimes,
    udp.allergies,
    udp.goals,
    udp.created_at,
    udp.updated_at
  from public.user_diet_plans udp
  left join auth.users u on u.id = udp.user_id
  where udp.household_id = p_household_id;
end;
$$;

revoke all on function public.list_household_diet_plans(uuid) from public;
grant execute on function public.list_household_diet_plans(uuid) to authenticated;

-- ============================================================================
-- Migration des donnees existantes :
-- pour chaque meal_plans.diet_plan non null, on cree une ligne user_diet_plans
-- pour le OWNER du foyer (s'il n'a pas deja un profil).
-- ============================================================================
do $$
declare
  v_mp record;
begin
  for v_mp in
    select mp.household_id, mp.diet_plan, h.owner_id
    from public.meal_plans mp
    join public.households h on h.id = mp.household_id
    where mp.diet_plan is not null
  loop
    insert into public.user_diet_plans (user_id, household_id, diet_plan)
    values (v_mp.owner_id, v_mp.household_id, v_mp.diet_plan)
    on conflict (user_id, household_id) do nothing;
  end loop;
end $$;
