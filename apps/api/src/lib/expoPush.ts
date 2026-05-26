/**
 * Lib pour envoyer des push notifications via l'Expo Push API.
 *
 * Doc : https://docs.expo.dev/push-notifications/sending-notifications/
 *
 * Endpoint : POST https://exp.host/--/api/v2/push/send
 * Limite : pas de limite stricte, batchs de 100 messages max recommandes.
 */

export type ExpoPushMessage = {
  to: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  badge?: number;
  channelId?: string;
};

export type ExpoPushTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string; details?: { error?: string; expoPushToken?: string } };

export type ExpoPushSendResponse = {
  data?: ExpoPushTicket | ExpoPushTicket[];
  errors?: { code: string; message: string }[];
};

/**
 * Envoie un batch de messages via l'Expo Push API.
 * Retourne les tickets (un par message dans l'ordre).
 */
export async function sendExpoPushMessages(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
  if (messages.length === 0) return [];
  // Batch de 100 max
  const batches: ExpoPushMessage[][] = [];
  for (let i = 0; i < messages.length; i += 100) {
    batches.push(messages.slice(i, i + 100));
  }

  const allTickets: ExpoPushTicket[] = [];
  for (const batch of batches) {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Expo Push HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as ExpoPushSendResponse;
    const tickets = Array.isArray(json.data) ? json.data : json.data ? [json.data] : [];
    allTickets.push(...tickets);
  }
  return allTickets;
}

/**
 * Filtre les tickets en erreur et retourne les expoPushTokens a marquer
 * comme invalides (ex DeviceNotRegistered).
 */
export function extractInvalidTokens(
  messages: ExpoPushMessage[],
  tickets: ExpoPushTicket[],
): string[] {
  const invalid: string[] = [];
  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    if (!t || t.status !== 'error') continue;
    const code = t.details?.error;
    if (code === 'DeviceNotRegistered' || code === 'InvalidCredentials') {
      const msg = messages[i];
      if (msg) invalid.push(msg.to);
    }
  }
  return invalid;
}
