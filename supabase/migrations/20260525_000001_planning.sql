-- Mealendar - Migration Phase 1.7 : plannings + plan-type + planned_meals
--
-- Tables :
--   meal_plans          (plan-type d'un foyer : quels slots par jour de semaine)
--   plannings           (un planning genere pour une periode)
--   planned_meals       (les repas individuels du planning)
--
-- Toute l'ecriture passe par RPC SECURITY DEFINER pour eviter le souci RLS
-- qu'on a deja eu sur households / recipes.

-- ============================================================================
-- meal_plans : plan-type par foyer
-- Un foyer peut avoir plusieurs plan-types (ex : "semaine type", "vacances")
-- mais un seul est marque "default" a la fois.
-- ============================================================================
create table if not exists public.meal_plans (
  id              uuid primary key default uuid_generate_v4(),
  household_id    uuid not null references public.households(id) on delete cascade,
  name            text not null check (length(trim(name)) between 1 and 100),
  is_default      boolean not null default true,
  -- Configuration des slots par jour : {monday: [{key, time}], ...}
  slot_config     jsonb not null default '{}'::jsonb,
  -- Cibles nutritionnelles globales (jsonb : {kcal, proteinG, ...})
  nutrition_targets jsonb,
  -- Regles de variete (jsonb libre, ex : {minDaysBetweenSameRecipe: 3})
  variety_rules   jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists meal_plans_household_idx on public.meal_plans(household_id);

drop trigger if exists trg_meal_plans_updated_at on public.meal_plans;
create trigger trg_meal_plans_updated_at
  before update on public.meal_plans
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- plannings : un planning pour une periode (start_date -> end_date)
-- ============================================================================
create table if not exists public.plannings (
  id              uuid primary key default uuid_generate_v4(),
  household_id    uuid not null references public.households(id) on delete cascade,
  meal_plan_id    uuid references public.meal_plans(id) on delete set null,
  name            text not null default 'Planning' check (length(trim(name)) between 1 and 100),
  start_date      date not null,
  end_date        date not null check (end_date >= start_date),
  status          text not null default 'draft' check (status in ('draft','active','archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists plannings_household_idx on public.plannings(household_id);
create index if not exists plannings_dates_idx on public.plannings(household_id, start_date, end_date);

drop trigger if exists trg_plannings_updated_at on public.plannings;
create trigger trg_plannings_updated_at
  before update on public.plannings
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- planned_meals : un repas planifie a une date + slot
-- ============================================================================
create table if not exists public.planned_meals (
  id              uuid primary key default uuid_generate_v4(),
  planning_id     uuid not null references public.plannings(id) on delete cascade,
  date            date not null,
  slot_key        text not null check (length(slot_key) between 1 and 32),
  recipe_id       uuid references public.recipes(id) on delete set null,
  -- Si pas de recette mais plat custom (texte libre)
  custom_title    text,
  servings        int not null default 4 check (servings > 0),
  diners          uuid[] not null default '{}'::uuid[],
  locked          boolean not null default false,
  notes           text,
  position        int not null default 0,
  created_at      timestamptz not null default now()
);

-- Un seul repas par planning/date/slot/position (mais on autorise plusieurs
-- repas dans le meme slot via position differente ; ex : entree + plat).
create index if not exists planned_meals_planning_idx on public.planned_meals(planning_id);
create index if not exists planned_meals_planning_date_idx on public.planned_meals(planning_id, date);

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.meal_plans     enable row level security;
alter table public.plannings      enable row level security;
alter table public.planned_meals  enable row level security;

drop policy if exists "meal_plans_select_household" on public.meal_plans;
create policy "meal_plans_select_household"
  on public.meal_plans for select
  to authenticated
  using (public.is_household_member(household_id));

drop policy if exists "plannings_select_household" on public.plannings;
create policy "plannings_select_household"
  on public.plannings for select
  to authenticated
  using (public.is_household_member(household_id));

drop policy if exists "planned_meals_select_via_planning" on public.planned_meals;
create policy "planned_meals_select_via_planning"
  on public.planned_meals for select
  to authenticated
  using (
    exists (
      select 1 from public.plannings p
      where p.id = planned_meals.planning_id
        and public.is_household_member(p.household_id)
    )
  );

-- ============================================================================
-- RPC : upsert_meal_plan (cree ou met a jour le plan-type d'un foyer)
-- ============================================================================
create or replace function public.upsert_meal_plan(
  p_household_id uuid,
  p_name text,
  p_slot_config jsonb,
  p_nutrition_targets jsonb default null,
  p_variety_rules jsonb default null,
  p_meal_plan_id uuid default null
)
returns public.meal_plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_plan public.meal_plans%rowtype;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_household_member(p_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  if p_meal_plan_id is null then
    insert into public.meal_plans(household_id, name, slot_config, nutrition_targets, variety_rules)
         values (p_household_id, trim(p_name), p_slot_config, p_nutrition_targets, p_variety_rules)
      returning * into v_plan;
  else
    update public.meal_plans set
      name              = coalesce(trim(p_name), name),
      slot_config       = coalesce(p_slot_config, slot_config),
      nutrition_targets = coalesce(p_nutrition_targets, nutrition_targets),
      variety_rules     = coalesce(p_variety_rules, variety_rules)
    where id = p_meal_plan_id and household_id = p_household_id
    returning * into v_plan;

    if v_plan.id is null then
      raise exception 'Plan not found' using errcode = 'P0002';
    end if;
  end if;

  return v_plan;
end;
$$;

revoke all on function public.upsert_meal_plan(uuid, text, jsonb, jsonb, jsonb, uuid) from public;
grant execute on function public.upsert_meal_plan(uuid, text, jsonb, jsonb, jsonb, uuid) to authenticated;

-- ============================================================================
-- RPC : create_planning (cree un planning vide pour la periode)
-- ============================================================================
create or replace function public.create_planning(
  p_household_id uuid,
  p_start_date date,
  p_end_date date,
  p_meal_plan_id uuid default null,
  p_name text default null
)
returns public.plannings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_planning public.plannings%rowtype;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_household_member(p_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if p_end_date < p_start_date then
    raise exception 'end_date must be >= start_date' using errcode = '22023';
  end if;

  insert into public.plannings(household_id, meal_plan_id, name, start_date, end_date, status)
       values (
         p_household_id,
         p_meal_plan_id,
         coalesce(nullif(trim(p_name), ''), 'Planning'),
         p_start_date,
         p_end_date,
         'active'
       )
    returning * into v_planning;

  return v_planning;
end;
$$;

revoke all on function public.create_planning(uuid, date, date, uuid, text) from public;
grant execute on function public.create_planning(uuid, date, date, uuid, text) to authenticated;

-- ============================================================================
-- RPC : set_planning_meals (replace tous les meals non-locked d'un planning)
--   Args :
--     p_planning_id : planning cible
--     p_meals       : jsonb[] [{date, slotKey, recipeId, customTitle, servings, diners, position, locked}]
--     p_keep_locked : si true, garde les meals deja locked et n'ecrase que les autres
--   Retourne le planning + tous ses meals.
-- ============================================================================
create or replace function public.set_planning_meals(
  p_planning_id uuid,
  p_meals jsonb,
  p_keep_locked boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_planning public.plannings%rowtype;
  v_meal jsonb;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_planning from public.plannings where id = p_planning_id;
  if v_planning.id is null then
    raise exception 'Planning not found' using errcode = 'P0002';
  end if;
  if not public.is_household_member(v_planning.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  if p_keep_locked then
    delete from public.planned_meals
     where planning_id = p_planning_id and locked = false;
  else
    delete from public.planned_meals where planning_id = p_planning_id;
  end if;

  for v_meal in select * from jsonb_array_elements(coalesce(p_meals, '[]'::jsonb)) loop
    insert into public.planned_meals(
      planning_id, date, slot_key, recipe_id, custom_title,
      servings, diners, locked, notes, position
    )
    values (
      p_planning_id,
      (v_meal->>'date')::date,
      coalesce(v_meal->>'slotKey',''),
      nullif(v_meal->>'recipeId','')::uuid,
      v_meal->>'customTitle',
      coalesce(nullif(v_meal->>'servings','')::int, 4),
      coalesce(
        array(select jsonb_array_elements_text(v_meal->'diners'))::uuid[],
        '{}'::uuid[]
      ),
      coalesce((v_meal->>'locked')::boolean, false),
      v_meal->>'notes',
      coalesce(nullif(v_meal->>'position','')::int, 0)
    );
  end loop;

  return jsonb_build_object(
    'planning', to_jsonb(v_planning),
    'meals', (
      select coalesce(jsonb_agg(to_jsonb(m) order by m.date, m.position), '[]'::jsonb)
        from public.planned_meals m
       where m.planning_id = p_planning_id
    )
  );
end;
$$;

revoke all on function public.set_planning_meals(uuid, jsonb, boolean) from public;
grant execute on function public.set_planning_meals(uuid, jsonb, boolean) to authenticated;

-- ============================================================================
-- RPC : update_planned_meal (un seul meal : verrou, recette, servings, diners)
-- ============================================================================
create or replace function public.update_planned_meal(
  p_meal_id uuid,
  p_patch jsonb
)
returns public.planned_meals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_meal public.planned_meals%rowtype;
  v_planning public.plannings%rowtype;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_meal from public.planned_meals where id = p_meal_id;
  if v_meal.id is null then
    raise exception 'Meal not found' using errcode = 'P0002';
  end if;
  select * into v_planning from public.plannings where id = v_meal.planning_id;
  if not public.is_household_member(v_planning.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  update public.planned_meals set
    recipe_id    = case when p_patch ? 'recipeId'    then nullif(p_patch->>'recipeId','')::uuid    else recipe_id    end,
    custom_title = case when p_patch ? 'customTitle' then p_patch->>'customTitle'                  else custom_title end,
    servings     = case when p_patch ? 'servings'    then coalesce(nullif(p_patch->>'servings','')::int, servings) else servings end,
    diners       = case when p_patch ? 'diners'      then array(select jsonb_array_elements_text(p_patch->'diners'))::uuid[] else diners end,
    locked       = case when p_patch ? 'locked'      then coalesce((p_patch->>'locked')::boolean, locked) else locked end,
    notes        = case when p_patch ? 'notes'       then p_patch->>'notes'                        else notes        end
  where id = p_meal_id
  returning * into v_meal;

  return v_meal;
end;
$$;

revoke all on function public.update_planned_meal(uuid, jsonb) from public;
grant execute on function public.update_planned_meal(uuid, jsonb) to authenticated;

-- ============================================================================
-- RPC : delete_planning
-- ============================================================================
create or replace function public.delete_planning(p_planning_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_planning public.plannings%rowtype;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_planning from public.plannings where id = p_planning_id;
  if v_planning.id is null then
    raise exception 'Planning not found' using errcode = 'P0002';
  end if;
  if not public.is_household_member(v_planning.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  delete from public.plannings where id = p_planning_id;
  return true;
end;
$$;

revoke all on function public.delete_planning(uuid) from public;
grant execute on function public.delete_planning(uuid) to authenticated;
