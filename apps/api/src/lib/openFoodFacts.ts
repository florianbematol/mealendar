import type { OffProduct } from '@mealendar/shared';

/**
 * Open Food Facts client (lecture seule, cache KV).
 *
 * - Lookup par code-barres : https://world.openfoodfacts.org/api/v2/product/{ean}.json
 * - Recherche par nom     : https://world.openfoodfacts.org/cgi/search.pl?search_terms=...&json=1
 *
 * On cache les hits dans KV avec TTL pour limiter les appels reseau.
 */

const OFF_BASE = 'https://world.openfoodfacts.org';
const USER_AGENT = 'Mealendar/0.1 (https://github.com/anomalyco/mealendar)';

const BARCODE_TTL_S = 60 * 60 * 24 * 7; // 7 jours
const SEARCH_TTL_S = 60 * 60 * 24; // 24h

type RawProduct = {
  code?: string;
  product_name?: string;
  product_name_fr?: string;
  generic_name?: string;
  brands?: string;
  image_front_url?: string;
  image_url?: string;
  nutriments?: Record<string, number | string | undefined>;
  categories?: string;
  categories_tags?: string[];
  allergens_tags?: string[];
  serving_size?: string;
};

type RawByBarcodeResponse = {
  status?: number;
  status_verbose?: string;
  code?: string;
  product?: RawProduct;
};

function pickName(raw: RawProduct): string {
  return (
    raw.product_name_fr?.trim() ||
    raw.product_name?.trim() ||
    raw.generic_name?.trim() ||
    'Produit sans nom'
  );
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function mapProduct(raw: RawProduct, barcode: string): OffProduct {
  const n = raw.nutriments ?? {};
  return {
    barcode,
    name: pickName(raw),
    brand: raw.brands?.split(',')[0]?.trim() || null,
    imageUrl: raw.image_front_url ?? raw.image_url ?? null,
    defaultUnit: 'g',
    kcal100g: num(n['energy-kcal_100g']),
    protein100g: num(n.proteins_100g),
    carbs100g: num(n.carbohydrates_100g),
    fat100g: num(n.fat_100g),
    fiber100g: num(n.fiber_100g),
    category: raw.categories_tags?.[0] ?? null,
    allergens: (raw.allergens_tags ?? []).filter(Boolean),
  };
}

export async function fetchByBarcode(
  barcode: string,
  cache?: KVNamespace,
): Promise<OffProduct | null> {
  const cacheKey = `off:barcode:${barcode}`;
  if (cache) {
    const cached = await cache.get(cacheKey, 'json');
    if (cached !== null && cached !== undefined) {
      // sentinel : null cached pour eviter de re-fetcher les inconnus
      if (cached === '__not_found__') return null;
      return cached as OffProduct;
    }
  }

  const url = `${OFF_BASE}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=code,product_name,product_name_fr,generic_name,brands,image_front_url,image_url,nutriments,categories,categories_tags,allergens_tags`;

  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  } catch (err) {
    console.warn('[off] network error', err);
    return null;
  }
  if (!res.ok) return null;
  const body = (await res.json()) as RawByBarcodeResponse;
  if (body.status !== 1 || !body.product) {
    if (cache) {
      // sentinel pour ne pas re-checker pendant 24h
      await cache.put(cacheKey, JSON.stringify('__not_found__'), {
        expirationTtl: 60 * 60 * 24,
      });
    }
    return null;
  }

  const product = mapProduct(body.product, barcode);
  if (cache) {
    await cache.put(cacheKey, JSON.stringify(product), {
      expirationTtl: BARCODE_TTL_S,
    });
  }
  return product;
}

type RawSearchResponse = {
  count?: number;
  products?: RawProduct[];
};

export async function searchOff(
  query: string,
  limit: number,
  cache?: KVNamespace,
): Promise<OffProduct[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const safeLimit = Math.max(1, Math.min(limit, 20));
  const cacheKey = `off:search:${safeLimit}:${trimmed.toLowerCase()}`;
  if (cache) {
    const cached = await cache.get(cacheKey, 'json');
    if (cached) return cached as OffProduct[];
  }

  const params = new URLSearchParams({
    search_terms: trimmed,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: String(safeLimit),
    fields:
      'code,product_name,product_name_fr,generic_name,brands,image_front_url,image_url,nutriments,categories_tags,allergens_tags',
  });
  const url = `${OFF_BASE}/cgi/search.pl?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const body = (await res.json()) as RawSearchResponse;
  const products = (body.products ?? [])
    .filter((p) => !!p.code)
    .map((p) => mapProduct(p, p.code as string));

  if (cache) {
    await cache.put(cacheKey, JSON.stringify(products), {
      expirationTtl: SEARCH_TTL_S,
    });
  }
  return products;
}
