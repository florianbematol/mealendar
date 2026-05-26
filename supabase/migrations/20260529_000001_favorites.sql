-- Mealendar - Migration : favoris de recettes par utilisateur
-- Une recette peut etre favorisee par n'importe quel membre du foyer auquel
-- elle appartient. Le favori est lie au user (pas au foyer) pour permettre
-- des preferences individuelles.

create table if not exists public.recipe_favorites (
  recipe_id   uuid not null references public.recipes(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (recipe_id, user_id)
);

create index if not exists recipe_favorites_user_idx on public.recipe_favorites(user_id);

alter table public.recipe_favorites enable row level security;

-- Lecture : un user voit ses propres favoris uniquement
drop policy if exists "favorites_select_own" on public.recipe_favorites;
create policy "favorites_select_own"
  on public.recipe_favorites for select
  to authenticated
  using (user_id = auth.uid());

-- Insert : un user peut favoriser une recette de l'un de ses foyers
drop policy if exists "favorites_insert_own" on public.recipe_favorites;
create policy "favorites_insert_own"
  on public.recipe_favorites for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.recipes r
      where r.id = recipe_favorites.recipe_id
        and public.is_household_member(r.household_id)
    )
  );

-- Delete : seulement ses propres favoris
drop policy if exists "favorites_delete_own" on public.recipe_favorites;
create policy "favorites_delete_own"
  on public.recipe_favorites for delete
  to authenticated
  using (user_id = auth.uid());

-- ============================================================================
-- RPC : toggle_recipe_favorite (insert si absent, delete si present)
-- Retourne true = favori actif, false = retire.
-- ============================================================================
create or replace function public.toggle_recipe_favorite(p_recipe_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_recipe public.recipes%rowtype;
  v_exists boolean;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_recipe from public.recipes where id = p_recipe_id;
  if v_recipe.id is null then
    raise exception 'Recipe not found' using errcode = 'P0002';
  end if;
  if not public.is_household_member(v_recipe.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.recipe_favorites
    where recipe_id = p_recipe_id and user_id = v_user
  ) into v_exists;

  if v_exists then
    delete from public.recipe_favorites
     where recipe_id = p_recipe_id and user_id = v_user;
    return false;
  end if;

  insert into public.recipe_favorites(recipe_id, user_id)
  values (p_recipe_id, v_user);
  return true;
end;
$$;

revoke all on function public.toggle_recipe_favorite(uuid) from public;
grant execute on function public.toggle_recipe_favorite(uuid) to authenticated;
