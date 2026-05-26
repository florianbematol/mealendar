/**
 * Helper de parsing pour le champ jsonb `steps` des recipes.
 * Sortie : RecipeStep[] valide (id genere si absent).
 */
import { type RecipeStep, RecipeStepSchema } from '@mealendar/shared';

export function parseSteps(raw: unknown): RecipeStep[] {
  if (!Array.isArray(raw)) return [];
  const out: RecipeStep[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const candidate = {
      id: typeof obj.id === 'string' && obj.id.length > 0 ? obj.id : `s-${Date.now()}-${i}`,
      text: typeof obj.text === 'string' ? obj.text : '',
      durationMin:
        typeof obj.durationMin === 'number' && Number.isFinite(obj.durationMin)
          ? obj.durationMin
          : null,
    };
    const parsed = RecipeStepSchema.safeParse(candidate);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
