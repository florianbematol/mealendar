-- Mealendar - Migration : anti double-creation de foyer
-- Si un foyer avec le meme nom et le meme owner existe deja depuis moins
-- de 30 secondes, on retourne ce foyer au lieu d'en creer un nouveau.
-- Protection contre les double-clics rapides.

create or replace function public.create_household(
  p_name text,
  p_display_name text default null
)
returns public.households
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_household public.households%rowtype;
  v_clean_name text;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  v_clean_name := trim(p_name);
  if length(v_clean_name) = 0 then
    raise exception 'Name is required' using errcode = '22023';
  end if;

  -- Anti double-creation : si meme owner + meme nom dans les 30s, on renvoie
  -- le foyer existant.
  select * into v_household
    from public.households
   where owner_id = v_user
     and name = v_clean_name
     and created_at >= now() - interval '30 seconds'
   order by created_at desc
   limit 1;
  if v_household.id is not null then
    return v_household;
  end if;

  insert into public.households(name, owner_id)
       values (v_clean_name, v_user)
    returning * into v_household;

  if p_display_name is not null then
    update public.household_members
       set display_name = trim(p_display_name)
     where household_id = v_household.id and user_id = v_user;
  end if;

  return v_household;
end;
$$;

revoke all on function public.create_household(text, text) from public;
grant execute on function public.create_household(text, text) to authenticated;
