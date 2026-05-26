-- Mealendar - Migration Phase 4 : plan alimentaire structure
-- Ajoute meal_plans.diet_plan : description structuree (composants/categories par slot,
-- regles journalieres). Permet de definir un plan diet style "1 portion legumes,
-- viande 100-150g OU poisson 150-200g, 10 cas feculents, 1 fruit, ...".

alter table public.meal_plans
  add column if not exists diet_plan jsonb;

-- ============================================================================
-- RPC : upsert_meal_plan etendue avec p_diet_plan
-- (replace l'ancienne version sans diet_plan)
-- ============================================================================
drop function if exists public.upsert_meal_plan(uuid, text, jsonb, jsonb, jsonb, uuid);

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
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_household_member(p_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
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
grant execute on function public.upsert_meal_plan(uuid, text, jsonb, jsonb, jsonb, jsonb, uuid) to authenticated;
