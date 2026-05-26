# @mealendar/mobile

App Expo (SDK 54, React Native, TypeScript, Expo Router, RN Paper).

## Setup

1. Copier `.env.example` -> `.env.local` et y mettre les credentials Supabase :
   - `EXPO_PUBLIC_SUPABASE_URL` : URL du projet Supabase
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY` : cle anon (publique)

2. Lancer le backend Hono dans un terminal separe :
   ```
   pnpm dev:api
   ```

3. Lancer Metro :
   ```
   pnpm dev:mobile
   ```

4. Scanner le QR avec **Expo Go** (SDK 54) sur ton telephone.

## Structure

```
app/
  _layout.tsx          Root layout (providers + AuthGate)
  (auth)/
    _layout.tsx        Stack non authentifie
    login.tsx          Connexion
    signup.tsx         Creation de compte
  (app)/
    _layout.tsx        Stack authentifie + redirection onboarding si pas de foyer
    index.tsx          Ecran d'accueil
    onboarding.tsx     Creer ou rejoindre un foyer
src/
  hooks/               useAuth, useMe
  lib/                 supabase, api, config, queryClient, theme
  stores/              zustand : foyer actif persiste
```

## Flow auth

1. `_layout.tsx` (root) appelle `useAuth()` (qui lit la session depuis SecureStore)
2. Si pas de session -> redirige vers `(auth)/login`
3. Login/signup OK -> session stockee, retour vers `/`
4. `(app)/_layout.tsx` appelle `/api/me` pour recuperer les foyers
5. Si aucun foyer -> redirige vers `onboarding`
6. Sinon, foyer actif (dans Zustand persiste) selectionne automatiquement

## Notes

- Sur Hermes (moteur JS de RN), `@supabase/supabase-js` ESM ne fonctionne pas
  car il utilise `import()` dynamique. `metro.config.js` force la resolution
  vers le bundle CJS.
- Sur SDK 54 + pnpm, le repo est en `nodeLinker: hoisted` (cf. README racine).

## Configuration Supabase Auth

Pour que les emails de confirmation pointent vers l'app au lieu de
`http://localhost:3000`, configurer dans le dashboard Supabase
(Authentication > URL Configuration) :

### Site URL

```
mealendar://auth/confirm
```

### Redirect URLs (allowlist)

Ajouter dans la liste :

```
mealendar://*
exp://*
```

- `mealendar://*` : pour les builds Expo Dev Client et EAS Build (APK / AAB).
- `exp://*` : pour le dev en Expo Go (URL Metro `exp://192.168.x.x:8081/--/...`).

### Test du flow

1. Le user clique "Creer le compte" -> Supabase envoie un email avec un lien
   `mealendar://auth/confirm?code=...`.
2. Le user clique le lien depuis sa messagerie.
3. Le systeme ouvre l'app Mealendar et navigue vers `/auth/confirm`.
4. L'ecran echange le `code` contre une session, puis redirige vers `/`
   (qui amene aux tabs ou a l'onboarding).

## Build APK distribuable (EAS Build)

Le build APK est necessaire pour :
- Tester les push notifications (Expo Go ne les supporte plus depuis SDK 53).
- Distribuer l'app a un cercle restreint sans passer par les stores.

### Pre-requis

- Compte Expo gratuit (cf. https://expo.dev/signup).
- API Cloudflare Worker deployee (`pnpm --filter @mealendar/api deploy`),
  pour avoir une URL accessible depuis l'APK.

### Etapes

1. Installer eas-cli (une fois) :
   ```
   pnpm add -g eas-cli
   ```

2. Login Expo :
   ```
   eas login
   ```

3. Initialiser le project (cree extra.eas.projectId dans app.json) :
   ```
   cd apps/mobile
   eas init
   ```

4. Definir les variables d'environnement publiques pour le build APK
   (sinon `localhost:8787` sera utilise et l'app n'atteindra pas le backend) :
   ```
   eas env:create --scope project --name EXPO_PUBLIC_API_URL --value "https://mealendar-api.<account>.workers.dev" --visibility plaintext
   eas env:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value "https://xxx.supabase.co" --visibility plaintext
   eas env:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<key>" --visibility plaintext
   ```

5. Build APK preview (distribution interne, pas de Play Store) :
   ```
   eas build -p android --profile preview
   ```
   Le build prend 10-20 min sur les serveurs Expo. A la fin, un lien vers le
   .apk est genere : tu peux le telecharger directement sur le telephone, ou
   scanner le QR depuis le dashboard Expo.

6. Pour les builds suivants, increment `version` dans `app.json` puis re-run
   la commande.

### Build dev (avec metro local)

Pour itererer rapidement avec hot reload mais en ayant les fonctionnalites
bloquees dans Expo Go (notifications, certains modules natifs) :
```
eas build -p android --profile development
```
Une fois installe, l'app servira d'Expo Dev Client : tu lances `pnpm dev:mobile`
et l'APK ouvre directement la session Metro.
