# Supabase

Ce dossier contient les migrations SQL versionnees du schema Mealendar.

## Appliquer les migrations

### Option A - Script Mealendar (recommande)

Depuis la racine du repo, avec `SUPABASE_DB_URL` dans `apps/api/.dev.vars` :

```bash
pnpm db:status   # liste les migrations en attente
pnpm db:push     # applique toutes les migrations en attente
pnpm db:reset    # reset le tracking et reapplique tout (dev only)
```

Le script `scripts/db-push.mjs` cree une table `_mealendar_migrations` pour
suivre ce qui a ete applique.

### Option B - Dashboard Supabase (manuel)

1. Aller sur le projet Supabase -> SQL Editor.
2. Copier le contenu de chaque fichier `migrations/*.sql` dans l'ordre chronologique.
3. Cliquer sur "Run".

### Option C - Supabase CLI officielle

```bash
# Installer une fois : https://supabase.com/docs/guides/cli
supabase login
supabase link --project-ref <project-ref>
supabase db push
```

> Note : la CLI Supabase utilise son propre format de migrations (numerotation par date)
> et necessite Docker pour le dev local. Pour Mealendar on utilise le script maison
> qui marche directement sur la DB distante sans Docker.

## Conventions

- Nom de fichier : `YYYYMMDD_NNNNNN_description.sql`
- Toujours `create ... if not exists` et `drop policy if exists` pour rendre les migrations idempotentes.
- RLS active sur toutes les tables exposees a `anon` / `authenticated`.
- Helpers `is_household_member()` / `is_household_admin()` en `security definer` pour
  eviter la recursion infinie des policies sur `household_members`.

## Migrations actuelles

| Fichier | Contenu |
| --- | --- |
| `20260523_000001_baseline.sql` | Schema complet Phase 1 : `households`, `household_members`, RLS, helpers, RPC `join_household_by_code`, RPC `whoami` |

> **Important** : applique les migrations dans l'ordre chronologique (par date dans le nom de fichier).
> Si une operation API echoue avec `column households.X does not exist`, c'est qu'une migration manque.
