/**
 * Gestion des push notifications cote mobile.
 *
 * Flow :
 *  1. Au demarrage de l'app (apres login), on appelle `registerForPushNotifications`.
 *  2. Cette fonction demande la permission au user, recupere un token Expo,
 *     puis l'envoie au backend via /api/me/push-tokens.
 *  3. Au logout, on appelle `unregisterForPushNotifications` avec le token courant.
 *
 * Limitations :
 *  - Expo Go (SDK 53+) ne recoit plus les push notifications. On detecte ce
 *    cas via Constants.appOwnership === 'expo' et on skip silencieusement.
 *    Cette fonctionnalite necessite un Development Build ou un APK production
 *    (EAS Build).
 *  - On stocke le token courant en SecureStore pour pouvoir le retrouver au logout.
 *  - Les permissions iOS et Android se gerent via expo-notifications.
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { registerPushToken, unregisterPushToken } from './api';

const SECURE_STORE_KEY = 'mealendar.expoPushToken';

/**
 * Detecte si on tourne dans Expo Go (vs Development Build / APK production).
 * Dans Expo Go SDK 53+, les push remote notifications sont desactivees.
 */
function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}

/**
 * Configure le handler par defaut : on affiche les notifs quand l'app est au
 * foreground (sinon le user ne les voit que si l'app est fermee).
 */
export function configureNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      // SDK 53+ : nouveaux flags
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

/**
 * Demande la permission, recupere un token Expo, et l'enregistre cote backend.
 * Retourne le token si succes, null sinon (refus, simulator, web, Expo Go, etc.).
 */
export async function registerForPushNotifications(): Promise<string | null> {
  // Web : on saute (Expo Push ne supporte que iOS/Android)
  if (Platform.OS === 'web') return null;

  // Expo Go SDK 53+ : les push remote sont desactivees, on skip silencieusement
  // pour eviter le warning "expo-notifications: Android Push notifications [...]
  // functionality was removed from Expo Go".
  if (isExpoGo()) {
    console.log('[push] Expo Go detected - push notifications disabled, skipping registration');
    return null;
  }

  // Simulator/Emulator : Expo Push ne fonctionne pas, mais on continue quand
  // meme pour permettre le dev (ca echouera silencieusement cote backend).
  if (!Device.isDevice) {
    console.warn('[push] Push notifications non supportees sur emulator/simulator');
    // On continue quand meme pour pouvoir tester le flow.
  }

  // 1. Permission
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.warn('[push] Permission refusee');
    return null;
  }

  // 2. Channel Android
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Mealendar',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#3F7D58',
    });
  }

  // 3. Recupere le token Expo
  let token: string;
  try {
    const tokenData = await Notifications.getExpoPushTokenAsync();
    token = tokenData.data;
  } catch (e) {
    console.warn('[push] getExpoPushTokenAsync failed:', e);
    return null;
  }

  if (!token) return null;

  // 4. Stocke le token en SecureStore pour pouvoir l'unregister au logout
  try {
    await SecureStore.setItemAsync(SECURE_STORE_KEY, token);
  } catch (e) {
    // SecureStore peut echouer sur web ou en cas de probleme keychain.
    // On continue : le token sera quand meme enregistre cote backend.
    console.warn('[push] SecureStore set failed:', e);
  }

  // 5. Envoie au backend
  try {
    await registerPushToken({
      token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
    console.log('[push] Token enregistre cote serveur');
  } catch (e) {
    console.warn('[push] registerPushToken (backend) failed:', e);
  }

  return token;
}

/**
 * Au logout : recupere le token du SecureStore et le desinscrit cote backend.
 */
export async function unregisterForPushNotifications(): Promise<void> {
  let token: string | null = null;
  try {
    token = await SecureStore.getItemAsync(SECURE_STORE_KEY);
  } catch {
    // Ignore : on essaiera quand meme le delete par token courant si dispo.
  }

  if (!token) return;

  try {
    await unregisterPushToken(token);
  } catch (e) {
    console.warn('[push] unregisterPushToken (backend) failed:', e);
  }

  try {
    await SecureStore.deleteItemAsync(SECURE_STORE_KEY);
  } catch {
    // Ignore
  }
}
