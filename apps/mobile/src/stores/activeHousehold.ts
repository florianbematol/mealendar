import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

type ActiveHouseholdState = {
  householdId: string | null;
  setHouseholdId: (id: string | null) => void;
};

/**
 * Foyer actuellement selectionne par l'utilisateur (persiste sur disque).
 * - null tant qu'aucun foyer n'a ete choisi (ex: nouveau user, ou device fraichement reset)
 * - reset a la deconnexion via clearActiveHousehold()
 */
export const useActiveHousehold = create<ActiveHouseholdState>()(
  persist(
    (set) => ({
      householdId: null,
      setHouseholdId: (id) => set({ householdId: id }),
    }),
    {
      name: 'mealendar:active-household',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

export function clearActiveHousehold() {
  useActiveHousehold.getState().setHouseholdId(null);
}
