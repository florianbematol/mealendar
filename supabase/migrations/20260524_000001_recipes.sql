-- Mealendar - Migration Phase 1.5 : recettes + ingredients
--
-- Tables :
--   ingredients          (catalogue partage par foyer + custom + Open Food Facts cache)
--   recipes              (recettes du foyer, ecrites par les membres ou auto-genereees)
--   recipe_ingredients   (lien M:N recipe<->ingredient avec quantite)
--
-- RLS : lecture/ecriture par membres du foyer.
-- RPC : create_recipe, update_recipe pour bypass RLS proprement (cf. baseline).

-- ============================================================================
-- Extensions
-- ============================================================================
create extension if not exists pg_trgm;

-- ============================================================================
-- ingredients
-- Un ingredient peut etre :
--  - global (household_id NULL) : visible par tous, ex. import Open Food Facts
--  - prive a un foyer : creer un ingredient custom local
-- ============================================================================
create table if not exists public.ingredients (
  id              uuid primary key default uuid_generate_v4(),
  household_id    uuid references public.households(id) on delete cascade,
  name            text not null check (length(trim(name)) between 1 and 200),
  off_barcode     text,                            -- code-barre Open Food Facts si applicable
  default_unit    text not null default 'g',       -- g, ml, piece, c.a.s, c.a.c
  -- Valeurs nutritionnelles pour 100g (ou 100ml)
  kcal_100g       numeric,
  protein_100g    numeric,
  carbs_100g      numeric,
  fat_100g        numeric,
  fiber_100g      numeric,
  -- Tags / categories
  category        text,                            -- 'feculent', 'legume', 'fromage', 'proteine', 'fruit', 'autre'
  allergens       text[] not null default '{}',    -- codes Open Food Facts ('en:milk', ...)
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists ingredients_household_idx on public.ingredients(household_id);
create index if not exists ingredients_name_trgm_idx on public.ingredients using gin (name gin_trgm_ops);
create unique index if not exists ingredients_off_barcode_unique
  on public.ingredients (off_barcode) where off_barcode is not null;

-- ============================================================================
-- recipes
-- ============================================================================
create table if not exists public.recipes (
  id              uuid primary key default uuid_generate_v4(),
  household_id    uuid not null references public.households(id) on delete cascade,
  title           text not null check (length(trim(title)) between 1 and 200),
  description     text,
  servings        int not null default 4 check (servings > 0),
  prep_time_min   int check (prep_time_min is null or prep_time_min >= 0),
  cook_time_min   int check (cook_time_min is null or cook_time_min >= 0),
  instructions    text,                            -- markdown
  source          text not null default 'user',    -- 'user' | 'llm' | 'api'
  source_ref      text,                            -- url / id externe / model name
  image_url       text,
  diet_tags       text[] not null default '{}',    -- ['vegetarian', 'gluten_free', ...]
  meal_slots      text[] not null default '{}',    -- slots adaptes : ['breakfast','lunch','dinner','snack']
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists recipes_household_idx on public.recipes(household_id);
create index if not exists recipes_title_trgm_idx on public.recipes using gin (title gin_trgm_ops);

-- ============================================================================
-- recipe_ingredients (M:N)
-- ============================================================================
create table if not exists public.recipe_ingredients (
  id              uuid primary key default uuid_generate_v4(),
  recipe_id       uuid not null references public.recipes(id) on delete cascade,
  ingredient_id   uuid references public.ingredients(id) on delete set null,
  -- Si l'ingredient n'existe pas dans le catalogue, on garde son nom en clair
  ingredient_name text not null check (length(trim(ingredient_name)) between 1 and 200),
  quantity        numeric,
  unit            text,
  notes           text,
  position        int not null default 0,          -- ordre d'affichage
  created_at      timestamptz not null default now()
);

create index if not exists recipe_ingredients_recipe_idx on public.recipe_ingredients(recipe_id);
create index if not exists recipe_ingredients_ingredient_idx on public.recipe_ingredients(ingredient_id);

-- ============================================================================
-- updated_at trigger helper
-- ============================================================================
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_recipes_updated_at on public.recipes;
create trigger trg_recipes_updated_at
  before update on public.recipes
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_ingredients_updated_at on public.ingredients;
create trigger trg_ingredients_updated_at
  before update on public.ingredients
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.ingredients         enable row level security;
alter table public.recipes             enable row level security;
alter table public.recipe_ingredients  enable row level security;

-- Ingredients : tout le monde lit les globaux + ceux de ses foyers
drop policy if exists "ingredients_select_all" on public.ingredients;
create policy "ingredients_select_all"
  on public.ingredients for select
  to authenticated
  using (
    household_id is null
    or public.is_household_member(household_id)
  );

-- Pas d'INSERT/UPDATE/DELETE direct via PostgREST : passe par RPC SECURITY DEFINER
-- (necessaire pour eviter le souci RLS qu'on a deja eu sur households).

-- Recipes : lecture par membres du foyer
drop policy if exists "recipes_select_household" on public.recipes;
create policy "recipes_select_household"
  on public.recipes for select
  to authenticated
  using (public.is_household_member(household_id));

-- recipe_ingredients : lecture suit recipes (via le household_id de la recipe parente)
drop policy if exists "recipe_ingredients_select_via_recipe" on public.recipe_ingredients;
create policy "recipe_ingredients_select_via_recipe"
  on public.recipe_ingredients for select
  to authenticated
  using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_ingredients.recipe_id
        and public.is_household_member(r.household_id)
    )
  );

-- ============================================================================
-- RPC : create_recipe (SECURITY DEFINER)
-- ============================================================================
-- Cree une recette + ses ingredients en une transaction.
-- Args :
--   p_household_id : foyer cible (l'appelant doit etre membre)
--   p_recipe       : jsonb decrivant la recette
--   p_ingredients  : jsonb[] des ingredients
-- Retourne : la row recipes inseree (jsonb pour porter aussi les ingredients)

create or replace function public.create_recipe(
  p_household_id uuid,
  p_recipe jsonb,
  p_ingredients jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_recipe public.recipes%rowtype;
  v_ing jsonb;
  v_index int := 0;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_household_member(p_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  insert into public.recipes(
    household_id, title, description, servings, prep_time_min, cook_time_min,
    instructions, source, source_ref, image_url, diet_tags, meal_slots, created_by
  )
  values (
    p_household_id,
    coalesce(p_recipe->>'title',''),
    p_recipe->>'description',
    coalesce((p_recipe->>'servings')::int, 4),
    nullif(p_recipe->>'prepTimeMin','')::int,
    nullif(p_recipe->>'cookTimeMin','')::int,
    p_recipe->>'instructions',
    coalesce(p_recipe->>'source','user'),
    p_recipe->>'sourceRef',
    p_recipe->>'imageUrl',
    coalesce(
      array(select jsonb_array_elements_text(p_recipe->'dietTags')),
      '{}'::text[]
    ),
    coalesce(
      array(select jsonb_array_elements_text(p_recipe->'mealSlots')),
      '{}'::text[]
    ),
    v_user
  )
  returning * into v_recipe;

  for v_ing in select * from jsonb_array_elements(p_ingredients) loop
    insert into public.recipe_ingredients(
      recipe_id, ingredient_id, ingredient_name, quantity, unit, notes, position
    )
    values (
      v_recipe.id,
      nullif(v_ing->>'ingredientId','')::uuid,
      coalesce(v_ing->>'name',''),
      nullif(v_ing->>'quantity','')::numeric,
      v_ing->>'unit',
      v_ing->>'notes',
      v_index
    );
    v_index := v_index + 1;
  end loop;

  return jsonb_build_object(
    'recipe', to_jsonb(v_recipe),
    'ingredients', (
      select coalesce(jsonb_agg(to_jsonb(ri) order by ri.position), '[]'::jsonb)
        from public.recipe_ingredients ri
       where ri.recipe_id = v_recipe.id
    )
  );
end;
$$;

revoke all on function public.create_recipe(uuid, jsonb, jsonb) from public;
grant execute on function public.create_recipe(uuid, jsonb, jsonb) to authenticated;

-- ============================================================================
-- RPC : update_recipe
-- ============================================================================
create or replace function public.update_recipe(
  p_recipe_id uuid,
  p_recipe jsonb,
  p_ingredients jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_existing public.recipes%rowtype;
  v_recipe public.recipes%rowtype;
  v_ing jsonb;
  v_index int := 0;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_existing from public.recipes where id = p_recipe_id;
  if v_existing.id is null then
    raise exception 'Recipe not found' using errcode = 'P0002';
  end if;
  if not public.is_household_member(v_existing.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  update public.recipes set
    title          = coalesce(p_recipe->>'title', title),
    description    = coalesce(p_recipe->>'description', description),
    servings       = coalesce(nullif(p_recipe->>'servings','')::int, servings),
    prep_time_min  = case when p_recipe ? 'prepTimeMin'
                          then nullif(p_recipe->>'prepTimeMin','')::int
                          else prep_time_min end,
    cook_time_min  = case when p_recipe ? 'cookTimeMin'
                          then nullif(p_recipe->>'cookTimeMin','')::int
                          else cook_time_min end,
    instructions   = coalesce(p_recipe->>'instructions', instructions),
    image_url      = coalesce(p_recipe->>'imageUrl', image_url),
    diet_tags      = case when p_recipe ? 'dietTags'
                          then coalesce(array(select jsonb_array_elements_text(p_recipe->'dietTags')), '{}'::text[])
                          else diet_tags end,
    meal_slots     = case when p_recipe ? 'mealSlots'
                          then coalesce(array(select jsonb_array_elements_text(p_recipe->'mealSlots')), '{}'::text[])
                          else meal_slots end
  where id = p_recipe_id
  returning * into v_recipe;

  if p_ingredients is not null then
    delete from public.recipe_ingredients where recipe_id = p_recipe_id;
    for v_ing in select * from jsonb_array_elements(p_ingredients) loop
      insert into public.recipe_ingredients(
        recipe_id, ingredient_id, ingredient_name, quantity, unit, notes, position
      )
      values (
        p_recipe_id,
        nullif(v_ing->>'ingredientId','')::uuid,
        coalesce(v_ing->>'name',''),
        nullif(v_ing->>'quantity','')::numeric,
        v_ing->>'unit',
        v_ing->>'notes',
        v_index
      );
      v_index := v_index + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'recipe', to_jsonb(v_recipe),
    'ingredients', (
      select coalesce(jsonb_agg(to_jsonb(ri) order by ri.position), '[]'::jsonb)
        from public.recipe_ingredients ri
       where ri.recipe_id = p_recipe_id
    )
  );
end;
$$;

revoke all on function public.update_recipe(uuid, jsonb, jsonb) from public;
grant execute on function public.update_recipe(uuid, jsonb, jsonb) to authenticated;

-- ============================================================================
-- RPC : delete_recipe
-- ============================================================================
create or replace function public.delete_recipe(p_recipe_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_existing public.recipes%rowtype;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_existing from public.recipes where id = p_recipe_id;
  if v_existing.id is null then
    raise exception 'Recipe not found' using errcode = 'P0002';
  end if;
  if not public.is_household_member(v_existing.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  delete from public.recipes where id = p_recipe_id;
  return true;
end;
$$;

revoke all on function public.delete_recipe(uuid) from public;
grant execute on function public.delete_recipe(uuid) to authenticated;
