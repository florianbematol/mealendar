/**
 * Tests pour les helpers de dates utilises par le planning et le LLM.
 */
import { describe, expect, it } from 'vitest';
import { rangeDates, toIsoString, weekdayOf } from '../src/lib/dates';

describe('weekdayOf', () => {
  it('retourne le bon jour pour quelques dates connues', () => {
    // 2026-01-12 = Monday (verifier via calendrier)
    expect(weekdayOf('2026-01-12')).toBe('monday');
    expect(weekdayOf('2026-01-13')).toBe('tuesday');
    expect(weekdayOf('2026-01-18')).toBe('sunday');
  });

  it('utilise UTC (pas de probleme de timezone)', () => {
    // 2026-05-23 = Saturday en UTC
    expect(weekdayOf('2026-05-23')).toBe('saturday');
  });

  it('fallback sur monday pour input invalide', () => {
    expect(weekdayOf('not-a-date')).toBe('monday');
  });
});

describe('rangeDates', () => {
  it('retourne toutes les dates inclusives entre start et end', () => {
    const dates = rangeDates('2026-01-12', '2026-01-15');
    expect(dates).toEqual(['2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15']);
  });

  it('retourne 1 element si start === end', () => {
    expect(rangeDates('2026-01-12', '2026-01-12')).toEqual(['2026-01-12']);
  });

  it('retourne tableau vide si end < start', () => {
    expect(rangeDates('2026-01-15', '2026-01-12')).toEqual([]);
  });

  it('traverse les frontieres de mois', () => {
    const dates = rangeDates('2026-01-30', '2026-02-02');
    expect(dates).toEqual(['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']);
  });

  it('traverse les annees bissextiles', () => {
    // 2024 est bissextile
    const dates = rangeDates('2024-02-28', '2024-03-01');
    expect(dates).toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
  });
});

describe('toIsoString', () => {
  it('normalise un timestamp Postgres', () => {
    const out = toIsoString('2026-05-23 09:45:50.764+00');
    expect(out).toMatch(/^2026-05-23T09:45:50\.\d{3}Z$/);
  });

  it('accepte un objet Date', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    expect(toIsoString(d)).toBe('2026-01-01T00:00:00.000Z');
  });

  it('throw sur input invalide', () => {
    expect(() => toIsoString('not-a-date')).toThrow();
  });
});
