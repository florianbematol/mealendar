-- Mealendar - Restreindre la config de la semaine type (meal_plans) au owner
--
-- Avant : tout membre du foyer pouvait creer/modifier le plan-type via
-- upsert_meal_plan. Desormais seul le proprietaire du foyer (households.owner_id)
-- peut le faire. Les autres membres recoivent une erreur 42501.
--
-- Le plan alimentaire personnel (user_diet_plans) n'est PAS concerne : chaque
-- membre continue d'editer le sien.

create or replace function public.upsert_meal_plan(
  p_household_id uuid,
  p_name text,
  p_slot_config jsonb,
  p_nutrition_targets jsonb default null,
  p_variety_rules jsonb default null,
  p_diet_plan jsonb default null,
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
  v_owner uuid;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_household_member(p_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  -- Seul le proprietaire du foyer peut configurer la semaine type.
  select owner_id into v_owner from public.households where id = p_household_id;
  if v_owner is null then
    raise exception 'Household not found' using errcode = 'P0002';
  end if;
  if v_owner <> v_user then
    raise exception 'Only the household owner can configure the meal plan'
      using errcode = '42501';
  end if;

  if p_meal_plan_id is null then
    insert into public.meal_plans(
      household_id, name, slot_config, nutrition_targets, variety_rules, diet_plan
    )
    values (
      p_household_id, trim(p_name), p_slot_config,
      p_nutrition_targets, p_variety_rules, p_diet_plan
    )
    returning * into v_plan;
  else
    update public.meal_plans set
      name              = coalesce(trim(p_name), name),
      slot_config       = coalesce(p_slot_config, slot_config),
      nutrition_targets = coalesce(p_nutrition_targets, nutrition_targets),
      variety_rules     = coalesce(p_variety_rules, variety_rules),
      diet_plan         = coalesce(p_diet_plan, diet_plan)
    where id = p_meal_plan_id and household_id = p_household_id
    returning * into v_plan;

    if v_plan.id is null then
      raise exception 'Plan not found' using errcode = 'P0002';
    end if;
  end if;

  return v_plan;
end;
$$;

revoke all on function public.upsert_meal_plan(uuid, text, jsonb, jsonb, jsonb, jsonb, uuid) from public;
revoke execute on function public.upsert_meal_plan(uuid, text, jsonb, jsonb, jsonb, jsonb, uuid) from anon;
grant execute on function public.upsert_meal_plan(uuid, text, jsonb, jsonb, jsonb, jsonb, uuid) to authenticated;
