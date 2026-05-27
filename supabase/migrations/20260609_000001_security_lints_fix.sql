-- Mealendar - Fix Supabase security advisor lints
--
-- Repond aux findings du linter de securite Supabase :
--   1. ERROR rls_disabled_in_public          : _mealendar_migrations sans RLS
--  27. WARN  anon_security_definer_function_executable
--      -> revoke from anon sur les RPCs metier (toutes appellent auth.uid()
--         et donc echoueraient pour anon, mais autant retirer le grant)
--   5. WARN  function_search_path_mutable    : search_path non fixe
--      -> set search_path = public sur 4 fonctions (whoami est drop)
--   1. WARN  extension_in_public              : pg_trgm dans public
--      -> bouger dans schema extensions (avec drop+recreate des indexes)
--   1. WARN  public_bucket_allows_listing    : recipe_images_public_read
--      -> drop la policy SELECT (URL publique fonctionne sans elle)
--
-- Reste 27 WARN authenticated_security_definer_function_executable :
-- volontaire, c'est notre workaround RLS. A ignorer cote dashboard.
--
-- L'action manuelle "leaked password protection ON" se fait dans le dashboard
-- Supabase (Authentication -> Providers -> Email -> "Leaked password protection").

-- ============================================================================
-- 1. RLS sur _mealendar_migrations (table interne, ne doit pas etre exposee)
-- ============================================================================
alter table public._mealendar_migrations enable row level security;
-- Aucune policy : personne ne peut SELECT/INSERT depuis l'API REST.
-- Le script db-push.mjs utilise l'admin DB URL (postgres direct), pas PostgREST,
-- donc il bypasse RLS et continue de fonctionner.

-- Defense en profondeur : revoke explicit pour public + roles standards.
revoke all on table public._mealendar_migrations from public;
revoke all on table public._mealendar_migrations from anon;
revoke all on table public._mealendar_migrations from authenticated;

-- ============================================================================
-- 2. Drop la fonction whoami (deprecated, plus appelee par le mobile)
-- ============================================================================
drop function if exists public.whoami();

-- ============================================================================
-- 3. set search_path = public sur les 4 fonctions restantes du warn
--    (security definer ou non, le linter le veut sur toutes les fonctions
--     qui ne le precisent pas explicitement)
-- ============================================================================

-- generate_invite_code : utilitaire (genere une string), security invoker.
create or replace function public.generate_invite_code()
returns text
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- pas de 0/O/1/I/L
  out_code text := '';
  i int;
begin
  for i in 1..6 loop
    out_code := out_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out_code;
end;
$$;

-- set_invite_code_if_null : trigger qui pose un invite_code unique.
create or replace function public.set_invite_code_if_null()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  candidate text;
begin
  if new.invite_code is null then
    loop
      candidate := public.generate_invite_code();
      exit when not exists (select 1 from public.households where invite_code = candidate);
    end loop;
    new.invite_code := candidate;
  end if;
  return new;
end;
$$;

-- tg_set_updated_at : trigger generique pour updated_at.
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- user_diet_plans_touch_updated_at : trigger user_diet_plans (idem).
create or replace function public.user_diet_plans_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ============================================================================
-- 4. revoke from anon sur les RPCs SECURITY DEFINER metier
--
-- Le mobile appelle l'API via JWT user (-> role authenticated). anon n'a
-- jamais besoin d'executer ces RPCs. Toutes ces fonctions echoueraient
-- de toute facon pour anon (auth.uid() est null), mais autant retirer
-- explicitement le grant pour calmer le linter et reduire la surface.
--
-- Les fonctions qui n'existent pas sur cette branche (set_meals_for_range,
-- delete_planned_meal) sont gerees dans la migration calendar-libre
-- (qui ajoutera elle aussi le revoke).
-- ============================================================================

-- helpers RLS (utilises a l'interieur de policies + RPCs)
revoke execute on function public.is_household_member(uuid) from anon;
revoke execute on function public.is_household_admin(uuid) from anon;

-- household
revoke execute on function public.create_household(text, text) from anon;
revoke execute on function public.add_owner_as_member() from anon;
revoke execute on function public.join_household_by_code(text, text) from anon;
revoke execute on function public.get_household_detail(uuid) from anon;
revoke execute on function public.regenerate_invite_code(uuid) from anon;
revoke execute on function public.leave_household(uuid) from anon;
revoke execute on function public.delete_household(uuid) from anon;

-- recipes
revoke execute on function public.create_recipe(uuid, jsonb, jsonb) from anon;
revoke execute on function public.update_recipe(uuid, jsonb, jsonb) from anon;
revoke execute on function public.delete_recipe(uuid) from anon;
revoke execute on function public.toggle_recipe_favorite(uuid) from anon;

-- planning / meal-plan
revoke execute on function public.upsert_meal_plan(uuid, text, jsonb, jsonb, jsonb, jsonb, uuid) from anon;
revoke execute on function public.update_planned_meal(uuid, jsonb) from anon;

-- ingredients
revoke execute on function public.upsert_ingredient(uuid, jsonb) from anon;
revoke execute on function public.search_ingredients(uuid, text, int) from anon;

-- llm
revoke execute on function public.count_llm_usage_since(timestamptz) from anon;
revoke execute on function public.record_llm_usage(uuid, text, text, text, boolean, integer, integer) from anon;

-- diet plans
revoke execute on function public.upsert_user_diet_plan(uuid, jsonb, text[], text[], text[]) from anon;
revoke execute on function public.get_my_diet_plan(uuid) from anon;
revoke execute on function public.list_household_diet_plans(uuid) from anon;

-- push tokens
revoke execute on function public.register_push_token(text, text) from anon;
revoke execute on function public.unregister_push_token(text) from anon;
revoke execute on function public.set_push_notifications_enabled(boolean) from anon;

-- ============================================================================
-- 5. Bucket recipe-images : drop la policy SELECT publique
--
-- Un bucket marque public=true expose les fichiers via leur URL sans que
-- la policy SELECT soit consultee. La policy "to public USING (bucket_id=...)"
-- ne sert donc qu'a permettre aux clients PostgREST de LISTER tous les
-- fichiers, ce qui n'est jamais souhaite. On la supprime.
--
-- Les URLs publiques (https://<proj>.supabase.co/storage/v1/object/public/...)
-- continuent de fonctionner.
-- ============================================================================
drop policy if exists "recipe_images_public_read" on storage.objects;

-- ============================================================================
-- 6. Bouger pg_trgm de public vers le schema extensions
--
-- Strategie : drop des indexes trigram, drop de l'extension, re-create dans
-- extensions, qualification explicite de similarity() dans search_ingredients
-- (search_path = public oblige a qualifier).
-- ============================================================================

-- 6.a Drop les indexes qui dependent de pg_trgm
drop index if exists public.recipes_title_trgm_idx;
drop index if exists public.ingredients_name_trgm_idx;

-- 6.b Drop + recreate l'extension dans le schema extensions (cree par defaut
--     dans les projets Supabase recents). La presence de "create schema if
--     not exists" rend la migration idempotente meme sur projets anciens.
create schema if not exists extensions;
drop extension if exists pg_trgm;
create extension if not exists pg_trgm with schema extensions;

-- 6.c Recree les indexes (operator class qualifie : extensions.gin_trgm_ops)
create index if not exists recipes_title_trgm_idx
  on public.recipes using gin (title extensions.gin_trgm_ops);
create index if not exists ingredients_name_trgm_idx
  on public.ingredients using gin (name extensions.gin_trgm_ops);

-- 6.d search_ingredients : qualifier extensions.similarity() puisque
--     search_path = public exclusivement (sinon erreur "function similarity
--     does not exist"). On reecrit la fonction.
create or replace function public.search_ingredients(
  p_household_id uuid,
  p_query text,
  p_limit int default 20
)
returns setof public.ingredients
language sql
stable
security definer
set search_path = public
as $$
  select i.*
    from public.ingredients i
   where (i.household_id = p_household_id or i.household_id is null)
     and (
       p_query is null or trim(p_query) = ''
       or i.name ilike '%' || p_query || '%'
     )
   order by
     case when i.household_id is null then 1 else 0 end,
     extensions.similarity(i.name, coalesce(p_query, '')) desc nulls last,
     i.name
   limit greatest(1, least(p_limit, 100));
$$;

revoke all on function public.search_ingredients(uuid, text, int) from public;
revoke execute on function public.search_ingredients(uuid, text, int) from anon;
grant execute on function public.search_ingredients(uuid, text, int) to authenticated;
