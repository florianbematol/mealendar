-- Mealendar - Migration : steps structures pour les recettes
--
-- On remplace recipes.instructions (text markdown) par recipes.steps (jsonb array).
-- Format : [{ id: string, text: string, durationMin?: number }]
--
-- Comme on est en dev sans donnees production, on supprime simplement l'ancienne
-- colonne. Les RPC create_recipe et update_recipe sont mises a jour pour lire
-- p_recipe->'steps' au lieu de p_recipe->>'instructions'.

alter table public.recipes
  drop column if exists instructions;

alter table public.recipes
  add column if not exists steps jsonb not null default '[]'::jsonb;

-- ============================================================================
-- RPC create_recipe : lit p_recipe->'steps'
-- ============================================================================
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
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_household_member(p_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  insert into public.recipes (
    household_id, title, description, servings, prep_time_min, cook_time_min,
    steps, source, source_ref, image_url, diet_tags, meal_slots, created_by
  )
  values (
    p_household_id,
    coalesce(p_recipe->>'title', 'Sans titre'),
    p_recipe->>'description',
    coalesce(nullif(p_recipe->>'servings','')::int, 4),
    nullif(p_recipe->>'prepTimeMin','')::int,
    nullif(p_recipe->>'cookTimeMin','')::int,
    coalesce(p_recipe->'steps', '[]'::jsonb),
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

  -- Insert ingredients (un par ligne)
  for v_ing in select * from jsonb_array_elements(coalesce(p_ingredients, '[]'::jsonb)) loop
    insert into public.recipe_ingredients(
      recipe_id, ingredient_name, quantity, unit, notes, ingredient_id, position
    )
    values (
      v_recipe.id,
      v_ing->>'name',
      nullif(v_ing->>'quantity','')::numeric,
      v_ing->>'unit',
      v_ing->>'notes',
      nullif(v_ing->>'ingredientId','')::uuid,
      coalesce(nullif(v_ing->>'position','')::int, 0)
    );
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
-- RPC update_recipe : lit p_recipe->'steps'
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
  v_recipe public.recipes%rowtype;
  v_household_id uuid;
  v_ing jsonb;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select household_id into v_household_id
  from public.recipes
  where id = p_recipe_id;

  if v_household_id is null then
    raise exception 'Recipe not found' using errcode = 'P0002';
  end if;
  if not public.is_household_member(v_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  update public.recipes set
    title          = coalesce(p_recipe->>'title', title),
    description    = case when p_recipe ? 'description' then p_recipe->>'description' else description end,
    servings       = coalesce(nullif(p_recipe->>'servings','')::int, servings),
    prep_time_min  = case when p_recipe ? 'prepTimeMin' then nullif(p_recipe->>'prepTimeMin','')::int else prep_time_min end,
    cook_time_min  = case when p_recipe ? 'cookTimeMin' then nullif(p_recipe->>'cookTimeMin','')::int else cook_time_min end,
    steps          = case when p_recipe ? 'steps' then coalesce(p_recipe->'steps', '[]'::jsonb) else steps end,
    image_url      = coalesce(p_recipe->>'imageUrl', image_url),
    diet_tags      = case when p_recipe ? 'dietTags' then
        coalesce(array(select jsonb_array_elements_text(p_recipe->'dietTags')), '{}'::text[])
      else diet_tags end,
    meal_slots     = case when p_recipe ? 'mealSlots' then
        coalesce(array(select jsonb_array_elements_text(p_recipe->'mealSlots')), '{}'::text[])
      else meal_slots end,
    updated_at     = now()
  where id = p_recipe_id
  returning * into v_recipe;

  -- Si p_ingredients passe, on remplace tout (delete + insert)
  if p_ingredients is not null then
    delete from public.recipe_ingredients where recipe_id = p_recipe_id;
    for v_ing in select * from jsonb_array_elements(p_ingredients) loop
      insert into public.recipe_ingredients(
        recipe_id, ingredient_name, quantity, unit, notes, ingredient_id, position
      )
      values (
        v_recipe.id,
        v_ing->>'name',
        nullif(v_ing->>'quantity','')::numeric,
        v_ing->>'unit',
        v_ing->>'notes',
        nullif(v_ing->>'ingredientId','')::uuid,
        coalesce(nullif(v_ing->>'position','')::int, 0)
      );
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
