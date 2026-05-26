// Configuration Metro custom pour Mealendar.
// Depuis SDK 52, Expo gere les monorepos par defaut.
// On ne surcharge que la resolution de @supabase/supabase-js -> bundle CJS,
// car le bundle ESM utilise import() dynamique non parse par Hermes.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..', '..');

const config = getDefaultConfig(projectRoot);

// Force le resolver Metro a utiliser le build CJS de @supabase/supabase-js
// (compatible Hermes). Le ESM utilise un import() dynamique non supporte.
const supabaseCjs = path.join(
  workspaceRoot,
  'node_modules',
  '@supabase',
  'supabase-js',
  'dist',
  'index.cjs',
);

const previous = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@supabase/supabase-js') {
    return { type: 'sourceFile', filePath: supabaseCjs };
  }
  if (previous) return previous(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
