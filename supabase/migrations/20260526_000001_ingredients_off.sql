-- Mealendar - Migration Phase 2 : ingredients (Open Food Facts integration)
-- - Conversions d'unites (g <-> ml <-> piece, c.a.s, c.a.c)
-- - RPC upsert_ingredient (cache OFF + customs foyer)
-- - RPC search_ingredients (recherche prefix sur le foyer + globaux)

-- ============================================================================
-- ingredient_unit_conversions
-- Stocke les ratios pour chaque ingredient :
--   from_unit + to_unit + factor
-- Exemple : pour le riz, 1 c.a.s -> 15 g
-- ============================================================================
create table if not exists public.ingredient_unit_conversions (
  ingredient_id   uuid not null references public.ingredients(id) on delete cascade,
  from_unit       text not null,
  to_unit         text not null,
  factor          numeric not null check (factor > 0),
  primary key (ingredient_id, from_unit, to_unit)
);

create index if not exists ing_unit_conv_ingredient_idx
  on public.ingredient_unit_conversions(ingredient_id);

alter table public.ingredient_unit_conversions enable row level security;

drop policy if exists "ing_unit_conv_select" on public.ingredient_unit_conversions;
create policy "ing_unit_conv_select"
  on public.ingredient_unit_conversions for select
  to authenticated
  using (
    exists (
      select 1 from public.ingredients i
      where i.id = ingredient_unit_conversions.ingredient_id
        and (i.household_id is null or public.is_household_member(i.household_id))
    )
  );

-- ============================================================================
-- RPC : upsert_ingredient (par foyer ou globaux pour cache OFF)
--   Si household_id null => ingredient global (cache Open Food Facts)
--   Si household_id => ingredient prive du foyer (l'appelant doit en etre membre)
--   Si off_barcode != null => upsert par barcode (idempotent)
-- ============================================================================
create or replace function public.upsert_ingredient(
  p_household_id uuid,
  p_payload jsonb
)
returns public.ingredients
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_ing  public.ingredients%rowtype;
  v_barcode text := nullif(p_payload->>'offBarcode','');
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_household_id is not null and not public.is_household_member(p_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  -- Cas 1 : OFF cache global (household_id = null + barcode) -> upsert sur barcode
  if p_household_id is null and v_barcode is not null then
    select * into v_ing from public.ingredients
     where off_barcode = v_barcode and household_id is null
     limit 1;
    if v_ing.id is not null then
      update public.ingredients set
        name         = coalesce(p_payload->>'name', name),
        default_unit = coalesce(p_payload->>'defaultUnit', default_unit),
        kcal_100g    = coalesce(nullif(p_payload->>'kcal100g','')::numeric, kcal_100g),
        protein_100g = coalesce(nullif(p_payload->>'protein100g','')::numeric, protein_100g),
        carbs_100g   = coalesce(nullif(p_payload->>'carbs100g','')::numeric, carbs_100g),
        fat_100g     = coalesce(nullif(p_payload->>'fat100g','')::numeric, fat_100g),
        fiber_100g   = coalesce(nullif(p_payload->>'fiber100g','')::numeric, fiber_100g),
        category     = coalesce(p_payload->>'category', category),
        allergens    = case when p_payload ? 'allergens'
                            then array(select jsonb_array_elements_text(p_payload->'allergens'))
                            else allergens end
      where id = v_ing.id
      returning * into v_ing;
      return v_ing;
    end if;
  end if;

  -- Cas 2 : insert (foyer ou global)
  insert into public.ingredients(
    household_id, name, off_barcode, default_unit,
    kcal_100g, protein_100g, carbs_100g, fat_100g, fiber_100g,
    category, allergens, created_by
  )
  values (
    p_household_id,
    coalesce(p_payload->>'name',''),
    v_barcode,
    coalesce(p_payload->>'defaultUnit','g'),
    nullif(p_payload->>'kcal100g','')::numeric,
    nullif(p_payload->>'protein100g','')::numeric,
    nullif(p_payload->>'carbs100g','')::numeric,
    nullif(p_payload->>'fat100g','')::numeric,
    nullif(p_payload->>'fiber100g','')::numeric,
    p_payload->>'category',
    coalesce(
      array(select jsonb_array_elements_text(p_payload->'allergens')),
      '{}'::text[]
    ),
    v_user
  )
  returning * into v_ing;

  return v_ing;
end;
$$;

revoke all on function public.upsert_ingredient(uuid, jsonb) from public;
grant execute on function public.upsert_ingredient(uuid, jsonb) to authenticated;

-- ============================================================================
-- RPC : search_ingredients (recherche prefix sur foyer + globaux)
-- ============================================================================
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
     case when i.household_id is null then 1 else 0 end,  -- foyer d'abord
     similarity(i.name, coalesce(p_query, '')) desc nulls last,
     i.name
   limit greatest(1, least(p_limit, 100));
$$;

revoke all on function public.search_ingredients(uuid, text, int) from public;
grant execute on function public.search_ingredients(uuid, text, int) to authenticated;
