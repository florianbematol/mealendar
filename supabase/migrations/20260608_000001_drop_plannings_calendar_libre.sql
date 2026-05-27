-- Mealendar - Refonte du modele Planning : suppression de l'entite plannings
--
-- Avant : meals etaient regroupes par 'plannings' (id, household_id, start_date,
-- end_date, name, ...). Chaque user devait creer un planning pour planifier
-- une semaine.
--
-- Maintenant : les meals sont rattaches DIRECTEMENT au foyer + une date.
-- Le calendrier mobile (vue mois/semaine) lit tous les meals du foyer dans
-- une fenetre arbitraire. Plus simple, plus flexible.
--
-- Migration steps :
-- 1. Ajouter planned_meals.household_id (nullable d'abord)
-- 2. Backfill : copier le household_id depuis le planning parent
-- 3. Rendre household_id NOT NULL
-- 4. Update RLS pour lire household_id directement
-- 5. Drop planned_meals.planning_id
-- 6. Drop la table plannings (et ses RPCs)
-- 7. Adapter les RPCs : set_meals (range), update_planned_meal (inchange logique)

-- ============================================================================
-- 1. Ajouter household_id (nullable d'abord)
-- ============================================================================
alter table public.planned_meals
  add column if not exists household_id uuid references public.households(id) on delete cascade;

-- ============================================================================
-- 2. Backfill depuis le planning parent
-- ============================================================================
update public.planned_meals pm
   set household_id = p.household_id
  from public.plannings p
 where pm.planning_id = p.id
   and pm.household_id is null;

-- ============================================================================
-- 3. Rendre household_id NOT NULL
-- ============================================================================
alter table public.planned_meals
  alter column household_id set not null;

create index if not exists planned_meals_household_date_idx
  on public.planned_meals(household_id, date);

-- ============================================================================
-- 4. Update RLS : on switch sur household_id directement
-- ============================================================================
drop policy if exists "planned_meals_select_members" on public.planned_meals;
create policy "planned_meals_select_members"
  on public.planned_meals for select
  to authenticated
  using (public.is_household_member(household_id));

drop policy if exists "planned_meals_insert_members" on public.planned_meals;
create policy "planned_meals_insert_members"
  on public.planned_meals for insert
  to authenticated
  with check (public.is_household_member(household_id));

drop policy if exists "planned_meals_update_members" on public.planned_meals;
create policy "planned_meals_update_members"
  on public.planned_meals for update
  to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists "planned_meals_delete_members" on public.planned_meals;
create policy "planned_meals_delete_members"
  on public.planned_meals for delete
  to authenticated
  using (public.is_household_member(household_id));

-- ============================================================================
-- 5. Drop la colonne planning_id
-- ============================================================================
alter table public.planned_meals
  drop column if exists planning_id cascade;

-- ============================================================================
-- 6. Drop les anciens RPCs lies aux plannings (avant de drop la table)
-- ============================================================================
drop function if exists public.create_planning(uuid, text, date, date, uuid);
drop function if exists public.set_planning_meals(uuid, jsonb, boolean);
drop function if exists public.update_planned_meal(uuid, jsonb);
drop function if exists public.delete_planning(uuid);

-- ============================================================================
-- 7. Drop la table plannings
-- ============================================================================
drop table if exists public.plannings cascade;

-- ============================================================================
-- 8. Nouveau RPC : set_meals_for_range
--
-- Remplace tous les meals du foyer dans une fenetre [date_from, date_to]
-- (inclusive) par la liste fournie. Les meals locked en dehors de la
-- fenetre ne sont jamais touches. Si keepLocked = true, les locked dans
-- la fenetre sont aussi preserves.
-- ============================================================================
create or replace function public.set_meals_for_range(
  p_household_id uuid,
  p_date_from date,
  p_date_to date,
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
  v_meal jsonb;
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

  -- Suppression des meals dans la fenetre (avec ou sans les locked)
  if p_keep_locked then
    delete from public.planned_meals
     where household_id = p_household_id
       and date between p_date_from and p_date_to
       and locked = false;
  else
    delete from public.planned_meals
     where household_id = p_household_id
       and date between p_date_from and p_date_to;
  end if;

  -- Insert des nouveaux meals (ne doivent pas avoir une date hors fenetre)
  for v_meal in select * from jsonb_array_elements(coalesce(p_meals, '[]'::jsonb)) loop
    if (v_meal->>'date')::date < p_date_from or (v_meal->>'date')::date > p_date_to then
      raise exception 'Meal date % outside [%, %]',
        v_meal->>'date', p_date_from, p_date_to using errcode = '22023';
    end if;
    insert into public.planned_meals(
      household_id, date, slot_key, recipe_id, custom_title,
      servings, diners, locked, notes, position, covers_meals
    )
    values (
      p_household_id,
      (v_meal->>'date')::date,
      coalesce(v_meal->>'slotKey', ''),
      nullif(v_meal->>'recipeId', '')::uuid,
      v_meal->>'customTitle',
      coalesce(nullif(v_meal->>'servings', '')::int, 4),
      coalesce(
        array(select jsonb_array_elements_text(v_meal->'diners'))::uuid[],
        '{}'::uuid[]
      ),
      coalesce((v_meal->>'locked')::boolean, false),
      v_meal->>'notes',
      coalesce(nullif(v_meal->>'position', '')::int, 0),
      coalesce(nullif(v_meal->>'coversMeals', '')::int, 1)
    );
  end loop;

  -- Retourne tous les meals du range apres update (pour synchroniser le client)
  return jsonb_build_object(
    'householdId', p_household_id,
    'dateFrom', p_date_from,
    'dateTo', p_date_to,
    'meals', (
      select coalesce(jsonb_agg(to_jsonb(m) order by m.date, m.position), '[]'::jsonb)
        from public.planned_meals m
       where m.household_id = p_household_id
         and m.date between p_date_from and p_date_to
    )
  );
end;
$$;

revoke all on function public.set_meals_for_range(uuid, date, date, jsonb, boolean) from public;
grant execute on function public.set_meals_for_range(uuid, date, date, jsonb, boolean) to authenticated;

-- ============================================================================
-- 9. Re-creer update_planned_meal (logique inchangee, juste sans planning_id)
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
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_meal from public.planned_meals where id = p_meal_id;
  if v_meal.id is null then
    raise exception 'Meal not found' using errcode = 'P0002';
  end if;
  if not public.is_household_member(v_meal.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  update public.planned_meals set
    recipe_id    = case when p_patch ? 'recipeId'    then nullif(p_patch->>'recipeId','')::uuid    else recipe_id    end,
    custom_title = case when p_patch ? 'customTitle' then p_patch->>'customTitle'                  else custom_title end,
    servings     = case when p_patch ? 'servings'    then coalesce(nullif(p_patch->>'servings','')::int, servings) else servings end,
    diners       = case when p_patch ? 'diners'      then array(select jsonb_array_elements_text(p_patch->'diners'))::uuid[] else diners end,
    locked       = case when p_patch ? 'locked'      then coalesce((p_patch->>'locked')::boolean, locked) else locked end,
    notes        = case when p_patch ? 'notes'       then p_patch->>'notes'                        else notes        end,
    covers_meals = case when p_patch ? 'coversMeals' then coalesce(nullif(p_patch->>'coversMeals','')::int, covers_meals) else covers_meals end
  where id = p_meal_id
  returning * into v_meal;

  return v_meal;
end;
$$;

revoke all on function public.update_planned_meal(uuid, jsonb) from public;
grant execute on function public.update_planned_meal(uuid, jsonb) to authenticated;

-- ============================================================================
-- 10. RPC delete_planned_meal (pratique pour la nouvelle UI)
-- ============================================================================
create or replace function public.delete_planned_meal(p_meal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_meal public.planned_meals%rowtype;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_meal from public.planned_meals where id = p_meal_id;
  if v_meal.id is null then
    raise exception 'Meal not found' using errcode = 'P0002';
  end if;
  if not public.is_household_member(v_meal.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  delete from public.planned_meals where id = p_meal_id;
end;
$$;

revoke all on function public.delete_planned_meal(uuid) from public;
grant execute on function public.delete_planned_meal(uuid) to authenticated;
