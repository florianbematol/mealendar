/**
 * Tests pour les helpers de l'API Expo Push.
 */
import { describe, expect, it } from 'vitest';
import {
  type ExpoPushMessage,
  type ExpoPushTicket,
  extractInvalidTokens,
} from '../src/lib/expoPush';

describe('extractInvalidTokens', () => {
  const messages: ExpoPushMessage[] = [
    { to: 'tok-A', title: 'A' },
    { to: 'tok-B', title: 'B' },
    { to: 'tok-C', title: 'C' },
    { to: 'tok-D', title: 'D' },
  ];

  it('extrait les tokens DeviceNotRegistered', () => {
    const tickets: ExpoPushTicket[] = [
      { status: 'ok', id: '1' },
      {
        status: 'error',
        message: 'not registered',
        details: { error: 'DeviceNotRegistered', expoPushToken: 'tok-B' },
      },
      { status: 'ok', id: '3' },
      {
        status: 'error',
        message: 'invalid',
        details: { error: 'InvalidCredentials' },
      },
    ];
    const invalid = extractInvalidTokens(messages, tickets);
    expect(invalid.sort()).toEqual(['tok-B', 'tok-D']);
  });

  it("ignore les autres types d'erreur", () => {
    const tickets: ExpoPushTicket[] = [
      { status: 'ok', id: '1' },
      {
        status: 'error',
        message: 'rate limited',
        details: { error: 'MessageRateExceeded' },
      },
      { status: 'ok', id: '3' },
      { status: 'ok', id: '4' },
    ];
    const invalid = extractInvalidTokens(messages, tickets);
    expect(invalid).toEqual([]);
  });

  it('renvoie tableau vide si tickets vides', () => {
    expect(extractInvalidTokens(messages, [])).toEqual([]);
  });

  it('aligne tickets et messages par index', () => {
    const tickets: ExpoPushTicket[] = [
      {
        status: 'error',
        message: '',
        details: { error: 'DeviceNotRegistered' },
      },
      { status: 'ok', id: '2' },
      { status: 'ok', id: '3' },
      { status: 'ok', id: '4' },
    ];
    const invalid = extractInvalidTokens(messages, tickets);
    expect(invalid).toEqual(['tok-A']);
  });

  it("n'ajoute pas un token si index sans message", () => {
    const tickets: ExpoPushTicket[] = [
      { status: 'ok', id: '1' },
      { status: 'ok', id: '2' },
      { status: 'ok', id: '3' },
      { status: 'ok', id: '4' },
      // 5e ticket sans message correspondant
      {
        status: 'error',
        message: 'phantom',
        details: { error: 'DeviceNotRegistered' },
      },
    ];
    const invalid = extractInvalidTokens(messages, tickets);
    expect(invalid).toEqual([]);
  });
});
