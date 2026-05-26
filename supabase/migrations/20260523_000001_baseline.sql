-- Mealendar - Baseline schema (Phase 1)
-- Migration consolidee qui cree TOUTE la structure necessaire au MVP.
-- Idempotente : peut etre re-jouee sans erreur sur une base deja a jour.
--
-- Tables :
--   households           (foyers, avec invite_code)
--   household_members    (appartenance + profil dietetique par membre)
-- Helpers :
--   is_household_member, is_household_admin
-- RPC :
--   join_household_by_code  (rejoindre un foyer par code, SECURITY DEFINER)
--   whoami                  (debug auth)
-- RLS :
--   policies par foyer pour authenticated + service_role bypass

-- ============================================================================
-- Extensions
-- ============================================================================
create extension if not exists "uuid-ossp";

-- ============================================================================
-- households
-- ============================================================================
create table if not exists public.households (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null check (length(trim(name)) between 1 and 100),
  owner_id    uuid not null references auth.users(id) on delete restrict,
  invite_code text,
  created_at  timestamptz not null default now()
);

create index if not exists households_owner_idx on public.households(owner_id);

-- Permet de rejouer la migration sur une base existante qui n'aurait pas la colonne
alter table public.households add column if not exists invite_code text;

-- ============================================================================
-- household_role enum
-- ============================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'household_role') then
    create type public.household_role as enum ('owner', 'admin', 'member');
  end if;
end$$;

-- ============================================================================
-- household_members
-- ============================================================================
create table if not exists public.household_members (
  household_id     uuid not null references public.households(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  role             public.household_role not null default 'member',
  display_name     text check (display_name is null or length(trim(display_name)) between 1 and 100),
  -- Profil dietetique : { diets: [], allergies: [], dailyTargets: {kcal,proteinG,...} }
  dietary_profile  jsonb,
  joined_at        timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index if not exists household_members_user_idx on public.household_members(user_id);

-- ============================================================================
-- Helpers SECURITY DEFINER (evitent la recursion infinie des policies sur
-- household_members : sans cela, une policy SELECT sur household_members qui
-- ferait elle-meme un SELECT sur household_members entrerait en boucle).
-- ============================================================================
create or replace function public.is_household_member(h_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.household_members
    where household_id = h_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_household_admin(h_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.household_members
    where household_id = h_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.households        enable row level security;
alter table public.household_members enable row level security;

-- households : lecture pour membres, ecriture restreinte
drop policy if exists "households_select_members" on public.households;
create policy "households_select_members"
  on public.households for select
  to authenticated
  using (public.is_household_member(id));

drop policy if exists "households_insert_self_owner" on public.households;
create policy "households_insert_self_owner"
  on public.households for insert
  to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "households_update_admin" on public.households;
create policy "households_update_admin"
  on public.households for update
  to authenticated
  using (public.is_household_admin(id))
  with check (public.is_household_admin(id));

drop policy if exists "households_delete_owner" on public.households;
create policy "households_delete_owner"
  on public.households for delete
  to authenticated
  using (owner_id = auth.uid());

-- household_members
drop policy if exists "members_select_own_or_household" on public.household_members;
create policy "members_select_own_or_household"
  on public.household_members for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_household_member(household_id)
  );

drop policy if exists "members_insert_admin" on public.household_members;
create policy "members_insert_admin"
  on public.household_members for insert
  to authenticated
  with check (
    public.is_household_admin(household_id)
    or exists (
      select 1 from public.households h
      where h.id = household_id and h.owner_id = auth.uid()
    )
  );

drop policy if exists "members_update_admin_or_self" on public.household_members;
create policy "members_update_admin_or_self"
  on public.household_members for update
  to authenticated
  using (
    user_id = auth.uid() or public.is_household_admin(household_id)
  )
  with check (
    user_id = auth.uid() or public.is_household_admin(household_id)
  );

drop policy if exists "members_delete_admin_or_self" on public.household_members;
create policy "members_delete_admin_or_self"
  on public.household_members for delete
  to authenticated
  using (
    user_id = auth.uid() or public.is_household_admin(household_id)
  );

-- ============================================================================
-- Trigger : a la creation d'un household, ajouter automatiquement l'owner
--           comme membre 'owner'.
-- ============================================================================
create or replace function public.add_owner_as_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.household_members(household_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trg_add_owner_as_member on public.households;
create trigger trg_add_owner_as_member
  after insert on public.households
  for each row execute function public.add_owner_as_member();

-- ============================================================================
-- Trigger : auto-generation d'un invite_code court a la creation
-- ============================================================================
create or replace function public.generate_invite_code()
returns text
language plpgsql
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- exclut 0,O,1,I,L
  code text;
  i int;
begin
  code := '';
  for i in 1..8 loop
    code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return code;
end;
$$;

create or replace function public.set_invite_code_if_null()
returns trigger
language plpgsql
as $$
declare
  attempts int := 0;
  candidate text;
begin
  if new.invite_code is not null then
    return new;
  end if;
  loop
    candidate := public.generate_invite_code();
    exit when not exists (select 1 from public.households where invite_code = candidate);
    attempts := attempts + 1;
    if attempts > 10 then
      raise exception 'Could not generate unique invite_code after 10 attempts';
    end if;
  end loop;
  new.invite_code := candidate;
  return new;
end;
$$;

drop trigger if exists trg_set_invite_code on public.households;
create trigger trg_set_invite_code
  before insert on public.households
  for each row execute function public.set_invite_code_if_null();

-- Backfill au cas ou des rows existaient deja sans invite_code
update public.households
   set invite_code = public.generate_invite_code()
 where invite_code is null;

-- Index unique pour les lookups par code (apres backfill)
create unique index if not exists households_invite_code_idx
  on public.households (invite_code);

-- ============================================================================
-- RPC : creer un foyer (SECURITY DEFINER pour bypasser les RLS)
--   Cree le foyer + l'ajoute au membre owner via le trigger.
--   Utilisable par tout user authentifie pour son propre compte.
-- ============================================================================
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
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  insert into public.households(name, owner_id)
       values (trim(p_name), v_user)
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

-- ============================================================================
-- RPC : rejoindre un foyer par code (SECURITY DEFINER)
-- ============================================================================
create or replace function public.join_household_by_code(
  p_invite_code text,
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
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_household
    from public.households
   where invite_code = upper(trim(p_invite_code))
   limit 1;

  if v_household.id is null then
    raise exception 'Invalid invite code' using errcode = 'P0002';
  end if;

  insert into public.household_members(household_id, user_id, role, display_name)
       values (v_household.id, v_user, 'member', p_display_name)
  on conflict (household_id, user_id) do update
    set display_name = coalesce(excluded.display_name, household_members.display_name);

  return v_household;
end;
$$;

revoke all on function public.join_household_by_code(text, text) from public;
grant execute on function public.join_household_by_code(text, text) to authenticated;

-- ============================================================================
-- RPC : whoami (debug auth)
--   Retourne ce que voit Postgres pour l'utilisateur courant.
--   Utile pour diagnostiquer les RLS.
-- ============================================================================
create or replace function public.whoami()
returns jsonb
language sql
stable
security invoker
as $$
  select jsonb_build_object(
    'uid',  auth.uid(),
    'role', auth.role(),
    'jwt_present', current_setting('request.jwt.claims', true) is not null,
    'claims', nullif(current_setting('request.jwt.claims', true), '')::jsonb
  );
$$;

grant execute on function public.whoami() to anon, authenticated;
