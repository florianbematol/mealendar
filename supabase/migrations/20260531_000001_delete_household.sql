-- Mealendar - Migration : suppression d'un foyer (owner only)
-- Cascade ON DELETE est deja configure sur :
--   household_members, recipes, plannings, meal_plans, recipe_favorites, etc.
-- => le DELETE sur households nettoie tout automatiquement.

create or replace function public.delete_household(p_household_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_household public.households%rowtype;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_household from public.households where id = p_household_id;
  if v_household.id is null then
    raise exception 'Household not found' using errcode = 'P0002';
  end if;
  if v_household.owner_id <> v_user then
    raise exception 'Only the owner can delete the household' using errcode = '42501';
  end if;
  delete from public.households where id = p_household_id;
  return true;
end;
$$;

revoke all on function public.delete_household(uuid) from public;
grant execute on function public.delete_household(uuid) to authenticated;
