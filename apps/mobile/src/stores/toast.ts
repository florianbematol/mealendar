/**
 * Store de toasts/snackbars globaux. Utilise pour afficher un feedback de
 * confirmation (action reussie, erreur recuperable) sans bloquer l'UI avec
 * un Alert.alert intrusif.
 *
 * Usage :
 *   const showToast = useToast((s) => s.show);
 *   showToast({ message: 'Recette enregistree', type: 'success' });
 *
 * Le composant <ToastHost /> doit etre rendu une fois (root layout).
 */
import { create } from 'zustand';

export type ToastType = 'success' | 'info' | 'error';

export type ToastConfig = {
  message: string;
  type?: ToastType;
  /** Duree en ms. Defaut 3000. */
  duration?: number;
  /** Optionnel : action cliquable a droite du message. */
  action?: { label: string; onPress: () => void };
};

type ToastState = {
  /** Toast courant (un seul a la fois pour rester simple). */
  current: (ToastConfig & { id: number }) | null;
  show: (cfg: ToastConfig) => void;
  hide: () => void;
};

let __toastUid = 0;

export const useToast = create<ToastState>((set) => ({
  current: null,
  show: (cfg) => {
    __toastUid += 1;
    set({ current: { ...cfg, id: __toastUid } });
  },
  hide: () => set({ current: null }),
}));

/**
 * Helpers de convenance : useToast.success(...), etc.
 * Permet d'eviter de re-importer le hook a chaque appel.
 */
export const toast = {
  success: (message: string, opts?: Omit<ToastConfig, 'message' | 'type'>) =>
    useToast.getState().show({ ...opts, message, type: 'success' }),
  info: (message: string, opts?: Omit<ToastConfig, 'message' | 'type'>) =>
    useToast.getState().show({ ...opts, message, type: 'info' }),
  error: (message: string, opts?: Omit<ToastConfig, 'message' | 'type'>) =>
    useToast.getState().show({ ...opts, message, type: 'error' }),
};
