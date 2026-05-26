-- Mealendar - Migration : detail complet d'un foyer (owner + invite_code + membres avec emails)

create or replace function public.get_household_detail(p_household_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_household public.households%rowtype;
  v_members jsonb;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_household_member(p_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  select * into v_household from public.households where id = p_household_id;
  if v_household.id is null then
    raise exception 'Household not found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'userId',      hm.user_id,
      'role',        hm.role,
      'displayName', hm.display_name,
      'email',       u.email,
      'joinedAt',    hm.joined_at
    )
    order by hm.joined_at
  ), '[]'::jsonb)
  into v_members
  from public.household_members hm
  join auth.users u on u.id = hm.user_id
  where hm.household_id = p_household_id;

  return jsonb_build_object(
    'id',          v_household.id,
    'name',        v_household.name,
    'ownerId',     v_household.owner_id,
    'inviteCode',  v_household.invite_code,
    'createdAt',   v_household.created_at,
    'members',     v_members
  );
end;
$$;

revoke all on function public.get_household_detail(uuid) from public;
grant execute on function public.get_household_detail(uuid) to authenticated;

-- ============================================================================
-- RPC : regenerate_invite_code (owner/admin uniquement)
-- ============================================================================
create or replace function public.regenerate_invite_code(p_household_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_household public.households%rowtype;
  v_attempts int := 0;
  v_code text;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_household_admin(p_household_id) then
    raise exception 'Only admins can regenerate the invite code' using errcode = '42501';
  end if;

  loop
    v_code := public.generate_invite_code();
    exit when not exists (select 1 from public.households where invite_code = v_code);
    v_attempts := v_attempts + 1;
    if v_attempts > 10 then
      raise exception 'Could not generate unique invite_code';
    end if;
  end loop;

  update public.households
     set invite_code = v_code
   where id = p_household_id
   returning * into v_household;

  return v_code;
end;
$$;

revoke all on function public.regenerate_invite_code(uuid) from public;
grant execute on function public.regenerate_invite_code(uuid) to authenticated;

-- ============================================================================
-- RPC : leave_household
-- ============================================================================
create or replace function public.leave_household(p_household_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role public.household_role;
  v_owner_count int;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select role into v_role
    from public.household_members
   where household_id = p_household_id and user_id = v_user;
  if v_role is null then
    raise exception 'Not a member' using errcode = 'P0002';
  end if;

  -- Le owner ne peut pas partir s'il est seul (cascade detruirait le foyer)
  if v_role = 'owner' then
    select count(*) into v_owner_count
      from public.household_members
     where household_id = p_household_id;
    if v_owner_count = 1 then
      raise exception 'Owner cannot leave : foyer vide. Supprimez le foyer ou transferez la propriete.' using errcode = '42501';
    end if;
  end if;

  delete from public.household_members
   where household_id = p_household_id and user_id = v_user;
  return true;
end;
$$;

revoke all on function public.leave_household(uuid) from public;
grant execute on function public.leave_household(uuid) to authenticated;
