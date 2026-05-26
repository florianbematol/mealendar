/**
 * Generation de planning aleatoire cote mobile.
 *
 * Strategie : pour chaque (date, slot) du planning :
 *  - Si le slot est deja locked, on le garde et on note les jours couverts
 *    (covers_days > 1 = on saute aussi le ou les jours suivants pour ce slot)
 *  - Filtre les recettes compatibles (mealSlots inclus, ou aucun mealSlots specifie)
 *  - Tirage pondere : on penalise les recettes utilisees recemment (selon
 *    minDaysBetweenSameRecipe de la varietyRules)
 */

import type {
  PlannedMeal,
  PlannedMealInput,
  RecipeListItem,
  SlotConfig,
  VarietyRules,
} from '@mealendar/shared';
import { addDays, rangeDates, weekdayOf } from './dates';

export type GenerateInput = {
  startDate: string;
  endDate: string;
  slotConfig: SlotConfig;
  recipes: RecipeListItem[];
  /** meals deja presents dans le planning ; si locked=true on les preserve */
  existingMeals: PlannedMeal[];
  varietyRules?: VarietyRules | null;
  /** par defaut nb personnes par repas (fallback) */
  defaultServings?: number;
};

export function generatePlanningMeals(input: GenerateInput): PlannedMealInput[] {
  const minDays = Math.max(0, input.varietyRules?.minDaysBetweenSameRecipe ?? 2);
  const defaultServings = Math.max(1, input.defaultServings ?? 4);

  const dates = rangeDates(input.startDate, input.endDate);
  const lockedByDateSlot = new Map<string, PlannedMeal[]>();
  for (const m of input.existingMeals) {
    if (!m.locked) continue;
    const k = `${m.date}|${m.slotKey}`;
    const arr = lockedByDateSlot.get(k) ?? [];
    arr.push(m);
    lockedByDateSlot.set(k, arr);
  }

  /**
   * Slots a skipper car couverts par un meal multi-jours.
   * Exemple : un meal locked le 2025-01-02 dinner avec coversDays=2
   *  -> on skip aussi 2025-01-03 dinner.
   */
  const coveredSlots = new Set<string>();
  for (const m of input.existingMeals) {
    if (!m.locked) continue;
    const cd = m.coversDays ?? 1;
    for (let i = 1; i < cd; i++) {
      const futureDate = addDays(m.date, i);
      coveredSlots.add(`${futureDate}|${m.slotKey}`);
    }
  }

  /** Map : recipeId -> derniere date d'utilisation (yyyy-mm-dd) */
  const lastUsage = new Map<string, string>();
  for (const m of input.existingMeals) {
    if (m.recipeId && m.locked) {
      const prev = lastUsage.get(m.recipeId);
      if (!prev || m.date > prev) lastUsage.set(m.recipeId, m.date);
    }
  }

  const out: PlannedMealInput[] = [];

  for (const date of dates) {
    const wd = weekdayOf(date);
    const slots = input.slotConfig[wd] ?? [];

    slots.forEach((slot, slotIdx) => {
      const slotKey = `${date}|${slot.key}`;
      const lockedHere = lockedByDateSlot.get(slotKey) ?? [];
      // Si un slot est deja locked, on le garde tel quel (l'API gardera les locked)
      if (lockedHere.length > 0) return;
      // Si le slot est couvert par un meal multi-jours precedent, on ne genere rien
      if (coveredSlots.has(slotKey)) return;

      const candidates = input.recipes.filter((r) => {
        if (r.mealSlots.length === 0) return true;
        return r.mealSlots.includes(slot.key);
      });
      if (candidates.length === 0) return;

      const scored = candidates.map((r) => {
        let weight = 1;
        const last = lastUsage.get(r.id);
        if (last) {
          // Calcule l'ecart en jours
          const daysSince = Math.round((Date.parse(date) - Date.parse(last)) / 86_400_000);
          if (daysSince < minDays) {
            weight = 0; // exclu
          } else {
            // recettes utilisees plus longtemps en arriere = poids plus eleve
            weight = 1 + Math.min(daysSince - minDays, 7);
          }
        } else {
          // jamais utilisee : leger boost
          weight = 2;
        }
        return { recipe: r, weight };
      });

      const eligible = scored.filter((s) => s.weight > 0);
      const pool = eligible.length > 0 ? eligible : scored.map((s) => ({ ...s, weight: 1 }));

      const total = pool.reduce((acc, s) => acc + s.weight, 0);
      let pick = Math.random() * total;
      let chosen = pool[0]?.recipe;
      for (const s of pool) {
        pick -= s.weight;
        if (pick <= 0) {
          chosen = s.recipe;
          break;
        }
      }
      if (!chosen) return;

      lastUsage.set(chosen.id, date);
      out.push({
        date,
        slotKey: slot.key,
        recipeId: chosen.id,
        servings: defaultServings,
        diners: [],
        locked: false,
        position: slotIdx,
        coversDays: 1,
      });
    });
  }

  return out;
}

/**
 * Calcule la date de fin pour un planning d'une semaine commencant a startDate.
 */
export function endOfWeek(startDate: string): string {
  return addDays(startDate, 6);
}
