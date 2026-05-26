import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Tracking local des composants du plan alimentaire coches par repas.
 * Cle = `${planningId}:${date}:${slotKey}` -> Set<componentId>
 *
 * On persiste en AsyncStorage pour rester simple. Plus tard, ce pourrait
 * etre persiste cote serveur (planned_meals.checked_components jsonb) si
 * plusieurs membres veulent partager l'etat.
 */

export type DietCheckKey = string; // `${planningId}:${date}:${slotKey}`

type DietChecksState = {
  checked: Record<DietCheckKey, string[]>;
  toggle: (key: DietCheckKey, componentId: string) => void;
  clearForPlanning: (planningId: string) => void;
  isChecked: (key: DietCheckKey, componentId: string) => boolean;
};

export const useDietChecks = create<DietChecksState>()(
  persist(
    (set, get) => ({
      checked: {},
      toggle: (key, componentId) =>
        set((s) => {
          const list = s.checked[key] ?? [];
          const exists = list.includes(componentId);
          const next = exists ? list.filter((c) => c !== componentId) : [...list, componentId];
          return { checked: { ...s.checked, [key]: next } };
        }),
      clearForPlanning: (planningId) =>
        set((s) => {
          const out: Record<DietCheckKey, string[]> = {};
          for (const [k, v] of Object.entries(s.checked)) {
            if (!k.startsWith(`${planningId}:`)) out[k] = v;
          }
          return { checked: out };
        }),
      isChecked: (key, componentId) => (get().checked[key] ?? []).includes(componentId),
    }),
    {
      name: 'mealendar:diet-checks',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

export function makeDietCheckKey(planningId: string, date: string, slotKey: string): DietCheckKey {
  return `${planningId}:${date}:${slotKey}`;
}
