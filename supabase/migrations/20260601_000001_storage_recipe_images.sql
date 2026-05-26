-- Mealendar - Migration : Supabase Storage pour les photos de recettes
--
-- Bucket "recipe-images" public en lecture (pour afficher les photos sans signed URL),
-- avec ecriture/suppression restreinte aux membres du foyer concerne.
--
-- Convention de chemin : <household_id>/<recipe_id>/<filename>
-- => les policies parsent le chemin pour determiner le foyer.

-- ============================================================================
-- Bucket
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recipe-images',
  'recipe-images',
  true,
  5 * 1024 * 1024, -- 5 MB max
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ============================================================================
-- Policies RLS sur storage.objects
-- ============================================================================

-- SELECT : public (le bucket est public, mais on garde une policy explicite pour clarte)
drop policy if exists "recipe_images_public_read" on storage.objects;
create policy "recipe_images_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'recipe-images');

-- INSERT : reserve aux membres du foyer (premier segment du chemin = household_id)
drop policy if exists "recipe_images_insert_member" on storage.objects;
create policy "recipe_images_insert_member"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'recipe-images'
    and public.is_household_member((storage.foldername(name))[1]::uuid)
  );

-- UPDATE / overwrite : idem
drop policy if exists "recipe_images_update_member" on storage.objects;
create policy "recipe_images_update_member"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'recipe-images'
    and public.is_household_member((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'recipe-images'
    and public.is_household_member((storage.foldername(name))[1]::uuid)
  );

-- DELETE : idem
drop policy if exists "recipe_images_delete_member" on storage.objects;
create policy "recipe_images_delete_member"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'recipe-images'
    and public.is_household_member((storage.foldername(name))[1]::uuid)
  );
