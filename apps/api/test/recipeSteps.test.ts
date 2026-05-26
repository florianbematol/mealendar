/**
 * Tests pour parseSteps : convertit le jsonb brut DB en RecipeStep[] propre.
 */
import { describe, expect, it } from 'vitest';
import { parseSteps } from '../src/lib/recipeSteps';

describe('parseSteps', () => {
  it('retourne tableau vide si input non-array', () => {
    expect(parseSteps(null)).toEqual([]);
    expect(parseSteps(undefined)).toEqual([]);
    expect(parseSteps('foo')).toEqual([]);
    expect(parseSteps({})).toEqual([]);
    expect(parseSteps(42)).toEqual([]);
  });

  it('parse un array de steps valides', () => {
    const out = parseSteps([
      { id: 's-1', text: 'Etape A', durationMin: 5 },
      { id: 's-2', text: 'Etape B', durationMin: null },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 's-1', text: 'Etape A', durationMin: 5 });
    expect(out[1]).toMatchObject({ id: 's-2', text: 'Etape B' });
  });

  it('genere un id si absent', () => {
    const out = parseSteps([{ text: 'Sans id' }]);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toMatch(/^s-\d+-0$/);
    expect(out[0]?.text).toBe('Sans id');
  });

  it('filtre les entries non-objet', () => {
    const out = parseSteps([{ text: 'A' }, null, 'string', 42, { text: 'B' }]);
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.text)).toEqual(['A', 'B']);
  });

  it('filtre les steps avec text vide (zod min(1) fail)', () => {
    const out = parseSteps([
      { id: 's-1', text: '' },
      { id: 's-2', text: 'B' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toBe('B');
  });

  it('durationMin = null si valeur invalide', () => {
    const out = parseSteps([
      { id: 's-1', text: 'A', durationMin: 'pas un nombre' },
      { id: 's-2', text: 'B', durationMin: Number.NaN },
      { id: 's-3', text: 'C', durationMin: 12 },
    ]);
    expect(out[0]?.durationMin).toBeNull();
    expect(out[1]?.durationMin).toBeNull();
    expect(out[2]?.durationMin).toBe(12);
  });
});
