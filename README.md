# Mealendar

Application mobile de planification de repas multi-utilisateurs avec generation
de menus, calcul des macros et liste de courses.

> Statut : **Phase 5 terminee** — toutes les phases du plan initial sont
> implementees. Reste : deploiement prod (CI), build APK distribuable,
> polish UX bonus.

## Stack

| Couche | Choix |
| --- | --- |
| Mobile | Expo + React Native + TypeScript + Expo Router + React Native Paper |
| State | TanStack Query + Zustand |
| Backend API | Hono + TypeScript sur Cloudflare Workers |
| Cache backend | Cloudflare KV |
| Auth + DB | Supabase (Postgres + Auth + RLS) |
| LLM | Gemini Flash (primaire) + Groq (fallback) |
| Nutrition | Open Food Facts |
| Monorepo | pnpm workspaces |
| Lint/format | Biome |

Cible budgetaire : **0 EUR/mois**, distribution via Expo Go puis EAS Build (preview APK).

## Structure

```
mealendar/
  apps/
    api/                 # Hono Worker (backend)
    mobile/              # Expo app
  packages/
    shared/              # types Zod partages
  supabase/
    migrations/          # SQL versionne
  .github/workflows/     # CI
```

## Pre-requis

- Node 20+ (la CI tourne sur Node 24, recommande pour eviter les warnings)
- pnpm 10+
- Comptes (gratuits) : Cloudflare, Supabase, Google AI Studio
- Pour iOS : Mac (sinon test via Expo Go uniquement)

> Le workspace utilise `nodeLinker: hoisted` (cf. `pnpm-workspace.yaml`)
> car React Native ne fonctionne pas avec l'install isolee par defaut de pnpm.
> [Recommandation officielle Expo](https://docs.expo.dev/guides/monorepos/#package-managers-with-isolated-dependencies).

## Setup

```bash
pnpm install
```

## Lancer en dev

### Backend (Hono Worker)

```bash
pnpm dev:api
# -> http://localhost:8787
# -> http://localhost:8787/health
```

### Mobile (Expo)

```bash
pnpm dev:mobile
```

Scanner le QR code avec **Expo Go** (Android/iOS).

### Comment l'app trouve le backend ?

Sur un **vrai telephone**, `localhost` pointe vers le telephone lui-meme, pas
vers le PC. L'app resoud l'URL de l'API dans cet ordre :

1. **`EXPO_PUBLIC_API_URL`** si definie (priorite max, ex : URL d'un Worker deploye)
2. **`extra.apiBaseUrl`** dans `apps/mobile/app.json` (autre que `localhost`)
3. **Auto-detection LAN** : Expo expose l'IP du PC qui fait tourner Metro
   (`Constants.expoConfig.hostUri`) ; on l'utilise pour pinger
   `http://<ip-pc>:8787`. C'est le mode par defaut quand on fait `pnpm dev:mobile`
   sur un telephone reel
4. Fallback : `http://localhost:8787` (utile pour emulateur/web)

Le backend (`pnpm dev:api`) est configure pour ecouter sur **toutes les interfaces**
(`0.0.0.0:8787`) afin d'etre joignable depuis le LAN.

### Si le telephone ne trouve pas l'API

1. **Pare-feu Windows** : autoriser les connexions entrantes sur le port 8787.
   Une fois en admin :
   ```powershell
   New-NetFirewallRule -DisplayName "Mealendar API Dev" `
     -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow `
     -Profile Private
   ```
2. **Reseau "Public"** sur Windows : passer le Wi-Fi en "Prive"
   (Settings -> Network -> Wi-Fi -> Properties -> Network profile type : Private)
3. **Telephone et PC pas sur le meme Wi-Fi** : indispensable pour le mode LAN
4. **Sinon, utiliser un tunnel Expo** :
   ```bash
   pnpm --filter @mealendar/mobile tunnel
   ```
   Et deployer le Worker (`pnpm --filter @mealendar/api deploy`), coller son URL
   dans `EXPO_PUBLIC_API_URL` ou dans `app.json -> extra.apiBaseUrl`.

## Commandes utiles

| Commande | Effet |
| --- | --- |
| `pnpm lint` | Biome check |
| `pnpm lint:fix` | Biome auto-fix |
| `pnpm typecheck` | TS sur tous les packages |
| `pnpm test` | Tests sur tous les packages |
| `pnpm dev:api` | Worker en local (wrangler dev) |
| `pnpm dev:mobile` | Expo dev server |

## Secrets backend (a configurer une fois)

### Pour `wrangler dev` (local) — `.dev.vars`

`wrangler dev` ne lit **PAS** les secrets pousses sur Cloudflare. En local,
il lit le fichier `apps/api/.dev.vars` (gitignore). Copier le template :

```bash
cd apps/api
cp .dev.vars.example .dev.vars
# editer .dev.vars avec les vraies valeurs
```

Variables attendues :

- `SUPABASE_URL` : URL du projet Supabase
- `SUPABASE_ANON_KEY` : cle anon (publique, RLS-protected)
- `SUPABASE_SERVICE_ROLE_KEY` : cle admin (bypass RLS - secret strict)
- `SUPABASE_JWT_SECRET` : Settings -> API -> JWT Secret
- `GEMINI_API_KEY` (optionnel pour Phase 1, requis Phase 3)

### Pour la prod (`wrangler deploy`)

```bash
cd apps/api
wrangler login                                # une seule fois
wrangler kv namespace create CACHE            # creer le namespace KV
# -> copier l'id genere dans wrangler.toml (section [[kv_namespaces]])

wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put SUPABASE_JWT_SECRET
wrangler secret put GEMINI_API_KEY
wrangler secret put GROQ_API_KEY              # optionnel, fallback
```

## Migrations Supabase

Les migrations SQL versionnees sont dans `supabase/migrations/`.

### Appliquer les migrations (recommande)

```bash
# Pre-requis : SUPABASE_DB_URL dans apps/api/.dev.vars
# (Dashboard -> Settings -> Database -> Connection string -> URI)

pnpm db:status                      # liste les migrations en attente, sans appliquer
pnpm db:push                        # applique toutes les migrations en attente
pnpm db:push --mark <filename>      # marque une migration comme deja appliquee
                                    # (utile si appliquee manuellement via SQL Editor)
pnpm db:reset                       # drop la table de tracking et reapplique tout
pnpm db:wipe                        # DROP toutes les tables Mealendar (dev only)
                                    # ne touche PAS auth.users
```

Le tracking se fait dans une table `_mealendar_migrations` creee automatiquement.

### Alternative : copier-coller dans le SQL Editor

Voir [`supabase/README.md`](./supabase/README.md).

## Deploiement API (Cloudflare Workers)### Manuel (premiere fois)

```bash
cd apps/api
wrangler login                                # une seule fois
wrangler kv namespace create CACHE            # creer le namespace KV
# -> copier l'id genere dans wrangler.toml (section [[kv_namespaces]])

# Pousser les secrets (a faire une fois, pas via CI) :
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put SUPABASE_JWT_SECRET
wrangler secret put GEMINI_API_KEY
wrangler secret put GROQ_API_KEY              # optionnel, fallback
wrangler secret put ADMIN_TOKEN               # optionnel, pour /api/admin/*

wrangler deploy
```

### Automatique (CI)

Le workflow `.github/workflows/deploy-api.yml` redeploie le Worker a chaque
push sur `main` qui touche `apps/api/**`, `packages/shared/**` ou le lockfile.
Lance aussi lint + typecheck + tests avant.

Pre-requis : ajouter dans GitHub Settings > Secrets and variables > Actions :

- `CLOUDFLARE_API_TOKEN` : Dashboard Cloudflare > My Profile > API Tokens >
  template **Edit Cloudflare Workers** (scope sur le compte uniquement, pas
  sur les zones DNS).
- `CLOUDFLARE_ACCOUNT_ID` : Dashboard Cloudflare > Workers & Pages > sidebar
  droite ("Account ID").

Les secrets du Worker (SUPABASE_*, GEMINI_*, etc.) sont **pousses manuellement**
une fois (cf. section ci-dessus). Le CI ne les manipule pas pour reduire la
surface d'attaque.

## Workflow PR (recommande)

Le repo a un PR template (`.github/pull_request_template.md`). Pour un workflow
sain :

- Travailler sur une branche dediee, jamais sur `main`.
- Push + ouvrir une PR avec `gh pr create` (utilise le template).
- Attendre que la CI passe (lint + typecheck + tests + coverage report posted
  en commentaire de la PR).
- Merge en squash pour garder l'historique propre.

> Note : la branch protection (block direct push to main, required PR reviews)
> n'est pas activee car elle necessite GitHub Pro pour les repos prives. Sur
> un repo public ou avec un compte Pro, l'activer dans Settings > Branches.

## Dependabot

Le repo a un `.github/dependabot.yml` qui cree des PRs automatiques chaque
lundi matin pour les npm minor/patch (groupes), et chaque vendredi pour les
GitHub Actions. Les bumps majeurs sur React/RN/Expo sont ignores et doivent
etre faits manuellement.

## Roadmap

- [x] Phase 0 - Setup monorepo, Worker `/health`, app Expo, migration foyers
- [x] Phase 1 - Auth, recettes manuelles, plan-type, planning, liste de courses
- [x] Phase 2 - Open Food Facts, scan code-barres, macros par recette
- [x] Phase 3 - Generation algorithmique + LLM (Gemini/Groq) avec cache + rate limit
- [x] Phase 4 - Partage foyer, favoris/tags, export, gestion membres
- [x] Phase 5 - Photos, import URL, ICS export, plan alimentaire, profil dietetique
              par membre, recipe steps structures, push notifications cron, EAS config

## License

MIT - voir [LICENSE](./LICENSE).
