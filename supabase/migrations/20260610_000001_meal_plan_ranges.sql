-- Mealendar - Plages de repas (meal_plan_ranges)
--
-- Permet de stocker des plages [date_from, date_to] nommees pour un foyer.
-- Les repas eux-memes restent dans planned_meals (household_id, date).
-- Une plage est juste un "marqueur" qu'on dessine sur le calendrier et
-- qu'on peut dupliquer.
--
-- Use case : "Semaine de menus equilibres" mise au point une fois, puis
-- dupliquee semaine apres semaine.

-- ============================================================================
-- 1. Table
-- ============================================================================
create table if not exists public.meal_plan_ranges (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  date_from date not null,
  date_to date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (date_to >= date_from)
);

create index if not exists meal_plan_ranges_household_idx
  on public.meal_plan_ranges(household_id, date_from);

create trigger meal_plan_ranges_updated_at
  before update on public.meal_plan_ranges
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- 2. RLS
-- ============================================================================
alter table public.meal_plan_ranges enable row level security;

create policy "meal_plan_ranges_select_members"
  on public.meal_plan_ranges for select
  to authenticated
  using (public.is_household_member(household_id));

create policy "meal_plan_ranges_insert_members"
  on public.meal_plan_ranges for insert
  to authenticated
  with check (public.is_household_member(household_id));

create policy "meal_plan_ranges_update_members"
  on public.meal_plan_ranges for update
  to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "meal_plan_ranges_delete_members"
  on public.meal_plan_ranges for delete
  to authenticated
  using (public.is_household_member(household_id));

-- ============================================================================
-- 3. RPCs (SECURITY DEFINER, workaround RLS habituel)
-- ============================================================================

-- create_meal_plan_range : pose une nouvelle plage. Renvoie la ligne creee.
create or replace function public.create_meal_plan_range(
  p_household_id uuid,
  p_name text,
  p_date_from date,
  p_date_to date
)
returns public.meal_plan_ranges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.meal_plan_ranges%rowtype;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_household_member(p_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if p_date_to < p_date_from then
    raise exception 'date_to must be >= date_from' using errcode = '22023';
  end if;

  insert into public.meal_plan_ranges(household_id, name, date_from, date_to)
  values (p_household_id, coalesce(nullif(trim(p_name), ''), 'Sans nom'), p_date_from, p_date_to)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_meal_plan_range(uuid, text, date, date) from public;
revoke execute on function public.create_meal_plan_range(uuid, text, date, date) from anon;
grant execute on function public.create_meal_plan_range(uuid, text, date, date) to authenticated;

-- update_meal_plan_range : permet de renommer ou redimensionner une plage.
create or replace function public.update_meal_plan_range(
  p_range_id uuid,
  p_patch jsonb
)
returns public.meal_plan_ranges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.meal_plan_ranges%rowtype;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_row from public.meal_plan_ranges where id = p_range_id;
  if v_row.id is null then
    raise exception 'Range not found' using errcode = 'P0002';
  end if;
  if not public.is_household_member(v_row.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  update public.meal_plan_ranges set
    name      = case when p_patch ? 'name'     then coalesce(nullif(trim(p_patch->>'name'), ''), name) else name end,
    date_from = case when p_patch ? 'dateFrom' then (p_patch->>'dateFrom')::date else date_from end,
    date_to   = case when p_patch ? 'dateTo'   then (p_patch->>'dateTo')::date   else date_to end
  where id = p_range_id
  returning * into v_row;

  if v_row.date_to < v_row.date_from then
    raise exception 'date_to must be >= date_from' using errcode = '22023';
  end if;

  return v_row;
end;
$$;

revoke all on function public.update_meal_plan_range(uuid, jsonb) from public;
revoke execute on function public.update_meal_plan_range(uuid, jsonb) from anon;
grant execute on function public.update_meal_plan_range(uuid, jsonb) to authenticated;

-- delete_meal_plan_range : supprime une plage (ne touche pas aux repas).
create or replace function public.delete_meal_plan_range(p_range_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.meal_plan_ranges%rowtype;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_row from public.meal_plan_ranges where id = p_range_id;
  if v_row.id is null then
    raise exception 'Range not found' using errcode = 'P0002';
  end if;
  if not public.is_household_member(v_row.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  delete from public.meal_plan_ranges where id = p_range_id;
end;
$$;

revoke all on function public.delete_meal_plan_range(uuid) from public;
revoke execute on function public.delete_meal_plan_range(uuid) from anon;
grant execute on function public.delete_meal_plan_range(uuid) to authenticated;

-- duplicate_meals_range : copie tous les meals presents dans
-- [source_from, source_to] vers une nouvelle plage commencant a target_start.
-- L'offset = target_start - source_from. Optionnellement cree aussi une
-- nouvelle meal_plan_ranges (entree calendrier).
--
-- Comportement par defaut :
--  - copie chaque meal a meal.date + offset
--  - keep_locked = true sur les meals de la zone cible (les locked existants
--    sont preserves, les autres sont remplaces)
--  - p_create_range_name : si non null, cree aussi une nouvelle plage nommee
create or replace function public.duplicate_meals_range(
  p_household_id uuid,
  p_source_from date,
  p_source_to date,
  p_target_start date,
  p_create_range_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_offset integer;
  v_target_end date;
  v_inserted integer := 0;
  v_range public.meal_plan_ranges%rowtype;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_household_member(p_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if p_source_to < p_source_from then
    raise exception 'source_to must be >= source_from' using errcode = '22023';
  end if;

  v_offset := p_target_start - p_source_from;
  v_target_end := p_source_to + v_offset;

  -- Supprime les meals non locked dans la zone cible
  delete from public.planned_meals
   where household_id = p_household_id
     and date between p_target_start and v_target_end
     and locked = false;

  -- Insere des copies des meals de la zone source, decalees de v_offset
  with src as (
    select * from public.planned_meals
     where household_id = p_household_id
       and date between p_source_from and p_source_to
  )
  insert into public.planned_meals(
    household_id, date, slot_key, recipe_id, custom_title,
    servings, diners, locked, notes, position, covers_meals
  )
  select
    household_id,
    date + v_offset,
    slot_key,
    recipe_id,
    custom_title,
    servings,
    diners,
    false, -- les copies ne sont jamais locked
    notes,
    position,
    covers_meals
  from src
  -- evite les doublons sur (household_id, date, slot_key) : on ne re-insere
  -- pas si un meal locked existe deja a la cible
  where not exists (
    select 1 from public.planned_meals pm
     where pm.household_id = src.household_id
       and pm.date = src.date + v_offset
       and pm.slot_key = src.slot_key
  );

  get diagnostics v_inserted = row_count;

  -- Cree la plage nommee si demande
  if p_create_range_name is not null then
    insert into public.meal_plan_ranges(household_id, name, date_from, date_to)
    values (p_household_id, coalesce(nullif(trim(p_create_range_name), ''), 'Copie'), p_target_start, v_target_end)
    returning * into v_range;
  end if;

  return jsonb_build_object(
    'inserted', v_inserted,
    'targetFrom', p_target_start,
    'targetTo', v_target_end,
    'rangeId', v_range.id
  );
end;
$$;

revoke all on function public.duplicate_meals_range(uuid, date, date, date, text) from public;
revoke execute on function public.duplicate_meals_range(uuid, date, date, date, text) from anon;
grant execute on function public.duplicate_meals_range(uuid, date, date, date, text) to authenticated;
