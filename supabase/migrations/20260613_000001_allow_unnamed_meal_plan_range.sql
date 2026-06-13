-- Mealendar - Autoriser les plages sans nom
--
-- Avant : create_meal_plan_range remplacait un nom vide par 'Sans nom'.
-- Desormais une plage peut etre reellement sans nom (chaine vide), pour les
-- plages creees automatiquement (ex. selection d'un jour sur le calendrier).
-- La bande s'affiche alors coloree mais sans texte.

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
  values (p_household_id, coalesce(trim(p_name), ''), p_date_from, p_date_to)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_meal_plan_range(uuid, text, date, date) from public;
revoke execute on function public.create_meal_plan_range(uuid, text, date, date) from anon;
grant execute on function public.create_meal_plan_range(uuid, text, date, date) to authenticated;
