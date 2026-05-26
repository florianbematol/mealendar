/**
 * Tests pour les helpers timezone du notification scheduler.
 *
 * Note : Paris alterne CET (UTC+1) en hiver et CEST (UTC+2) en ete.
 * On teste les deux saisons pour valider que les fonctions s'adaptent.
 */
import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  dateInParis,
  hourInParis,
  weekdayInParis,
} from '../src/lib/notificationsScheduler';

describe('hourInParis', () => {
  it('hiver (CET, UTC+1) : 19h UTC = 20h Paris', () => {
    // 2026-01-15 19:00 UTC = 2026-01-15 20:00 Paris (CET)
    const d = new Date('2026-01-15T19:00:00Z');
    expect(hourInParis(d)).toBe(20);
  });

  it('ete (CEST, UTC+2) : 18h UTC = 20h Paris', () => {
    // 2026-07-15 18:00 UTC = 2026-07-15 20:00 Paris (CEST)
    const d = new Date('2026-07-15T18:00:00Z');
    expect(hourInParis(d)).toBe(20);
  });

  it('change de jour : 23h Paris = jour J UTC-1', () => {
    // 2026-01-15 22:00 UTC = 2026-01-15 23:00 Paris
    const d = new Date('2026-01-15T22:00:00Z');
    expect(hourInParis(d)).toBe(23);
  });
});

describe('dateInParis', () => {
  it('rend la date YYYY-MM-DD heure locale Paris', () => {
    expect(dateInParis(new Date('2026-01-15T22:00:00Z'))).toBe('2026-01-15');
  });

  it('change de jour quand on passe minuit Paris', () => {
    // 2026-01-15 23:30 UTC = 2026-01-16 00:30 Paris
    expect(dateInParis(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-16');
  });
});

describe('weekdayInParis', () => {
  it('mappe correctement les jours de la semaine', () => {
    // 2026-01-12 = Monday, 2026-01-18 = Sunday
    expect(weekdayInParis(new Date('2026-01-12T12:00:00Z'))).toBe(1);
    expect(weekdayInParis(new Date('2026-01-13T12:00:00Z'))).toBe(2);
    expect(weekdayInParis(new Date('2026-01-14T12:00:00Z'))).toBe(3);
    expect(weekdayInParis(new Date('2026-01-15T12:00:00Z'))).toBe(4);
    expect(weekdayInParis(new Date('2026-01-16T12:00:00Z'))).toBe(5);
    expect(weekdayInParis(new Date('2026-01-17T12:00:00Z'))).toBe(6);
    expect(weekdayInParis(new Date('2026-01-18T12:00:00Z'))).toBe(0);
  });

  it('rebascule samedi -> dimanche en passant minuit Paris', () => {
    // 2026-01-17 23:30 UTC = 2026-01-18 00:30 Paris (Sunday)
    expect(weekdayInParis(new Date('2026-01-17T23:30:00Z'))).toBe(0);
  });
});

describe('addDaysIso', () => {
  it('ajoute des jours simplement', () => {
    expect(addDaysIso('2026-01-15', 1)).toBe('2026-01-16');
    expect(addDaysIso('2026-01-15', 7)).toBe('2026-01-22');
  });

  it('jour negatif = recule', () => {
    expect(addDaysIso('2026-01-15', -1)).toBe('2026-01-14');
  });

  it('passe le mois', () => {
    expect(addDaysIso('2026-01-31', 1)).toBe('2026-02-01');
  });

  it("passe l'annee", () => {
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });
});
