-- Mealendar - Migration : planned_meals.covers_days
-- Permet de marquer qu'un repas est cuisine pour plusieurs jours d'affilee
-- (ex: dimanche soir on prepare pour 4 personnes -> couvre dimanche + lundi)

alter table public.planned_meals
  add column if not exists covers_days int not null default 1
  check (covers_days >= 1 and covers_days <= 7);

-- ============================================================================
-- RPC set_planning_meals etendue : on supporte coversDays dans le payload
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
      servings, diners, locked, notes, position, covers_days
    )
    values (
      p_planning_id,
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
      coalesce(nullif(v_meal->>'coversDays', '')::int, 1)
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
-- RPC update_planned_meal : supporte coversDays dans le patch
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
    notes        = case when p_patch ? 'notes'       then p_patch->>'notes'                        else notes        end,
    covers_days  = case when p_patch ? 'coversDays'  then coalesce(nullif(p_patch->>'coversDays','')::int, covers_days) else covers_days end
  where id = p_meal_id
  returning * into v_meal;

  return v_meal;
end;
$$;

revoke all on function public.update_planned_meal(uuid, jsonb) from public;
grant execute on function public.update_planned_meal(uuid, jsonb) to authenticated;
