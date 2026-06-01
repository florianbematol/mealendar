/**
 * Tests pour normalizeParsedDietPlan : la couche de normalisation post-LLM
 * qui mappe les categories EN -> FR et regenere les ids/alternatives
 * manquants pour que le DietPlan extrait passe la validation Zod.
 */
import { DietPlanSchema } from '@mealendar/shared';
import { describe, expect, it } from 'vitest';
import { normalizeParsedDietPlan } from '../src/lib/llm';

describe('normalizeParsedDietPlan', () => {
  it('mappe les categories anglaises -> francaises', () => {
    const out = normalizeParsedDietPlan({
      slots: {
        breakfast: [
          {
            id: 'c1',
            label: 'Glucides',
            required: true,
            alternatives: [{ category: 'carb', label: 'Pain complet' }],
          },
        ],
      },
      dailyRules: [],
    });
    const cat = (out.slots.breakfast as Array<{ alternatives: Array<{ category: string }> }>)[0]
      ?.alternatives[0]?.category;
    expect(cat).toBe('feculent');
  });

  it('mappe protein/dairy/fat/vegetable correctement', () => {
    const out = normalizeParsedDietPlan({
      slots: {
        lunch: [
          {
            id: 'c1',
            label: 'Mix',
            required: true,
            alternatives: [
              { category: 'protein', label: 'Poulet' },
              { category: 'dairy', label: 'Yaourt' },
              { category: 'fat', label: 'Huile' },
              { category: 'vegetable', label: 'Salade' },
            ],
          },
        ],
      },
      dailyRules: [],
    });
    const alts = (out.slots.lunch as Array<{ alternatives: Array<{ category: string }> }>)[0]
      ?.alternatives;
    expect(alts?.[0]?.category).toBe('viande');
    expect(alts?.[1]?.category).toBe('produit_laitier');
    expect(alts?.[2]?.category).toBe('matiere_grasse');
    expect(alts?.[3]?.category).toBe('legumes');
  });

  it('retombe sur "autre" pour une categorie inconnue', () => {
    const out = normalizeParsedDietPlan({
      slots: {
        snack: [
          {
            id: 'c1',
            label: 'X',
            required: true,
            alternatives: [{ category: 'unknown_cat', label: 'X' }],
          },
        ],
      },
      dailyRules: [],
    });
    const cat = (out.slots.snack as Array<{ alternatives: Array<{ category: string }> }>)[0]
      ?.alternatives[0]?.category;
    expect(cat).toBe('autre');
  });

  it('genere un id si absent', () => {
    const out = normalizeParsedDietPlan({
      slots: {
        breakfast: [
          {
            label: 'Sans id',
            required: true,
            alternatives: [{ category: 'fruit', label: 'Pomme' }],
          },
        ],
      },
      dailyRules: [],
    });
    const comp = (out.slots.breakfast as Array<{ id: string }>)[0];
    expect(comp?.id).toBeDefined();
    expect(comp?.id.length).toBeGreaterThan(0);
  });

  it('reconstruit alternatives manquantes depuis le label du composant', () => {
    const out = normalizeParsedDietPlan({
      slots: {
        breakfast: [
          {
            id: 'c1',
            label: 'Boisson',
            required: true,
          },
        ],
      },
      dailyRules: [],
    });
    const alts = (
      out.slots.breakfast as Array<{ alternatives: Array<{ label: string; category: string }> }>
    )[0]?.alternatives;
    expect(alts).toHaveLength(1);
    expect(alts?.[0]?.label).toBe('Boisson');
    expect(alts?.[0]?.category).toBe('autre');
  });

  it('regenere les dailyRules mal formes (sans id ni alternatives)', () => {
    const out = normalizeParsedDietPlan({
      slots: {},
      dailyRules: [{ label: 'Hydratation' }, { label: 'Huile' }],
    });
    const rules = out.dailyRules as Array<{
      id: string;
      label: string;
      alternatives: unknown[];
    }>;
    expect(rules).toHaveLength(2);
    expect(rules[0]?.id).toBeDefined();
    expect(rules[0]?.alternatives.length).toBeGreaterThan(0);
    expect(rules[1]?.id).toBeDefined();
  });

  it('produit un DietPlan qui passe la validation Zod', () => {
    const out = normalizeParsedDietPlan({
      slots: {
        breakfast: [
          {
            id: 'c1',
            label: 'Glucides',
            required: true,
            alternatives: [{ category: 'carb', label: 'Pain' }],
          },
          {
            id: 'c2',
            label: 'Proteine',
            required: true,
            alternatives: [
              { category: 'protein', label: 'Oeuf' },
              { category: 'dairy', label: 'Yaourt' },
            ],
          },
        ],
        lunch: [
          {
            id: 'c3',
            label: 'Legumes',
            required: true,
            alternatives: [{ category: 'vegetable', label: 'Salade' }],
          },
        ],
      },
      dailyRules: [{ label: 'Eau 1.5L' }],
    });
    const validated = DietPlanSchema.safeParse(out);
    expect(validated.success).toBe(true);
  });

  it('preserve une categorie deja FR valide', () => {
    const out = normalizeParsedDietPlan({
      slots: {
        breakfast: [
          {
            id: 'c1',
            label: 'X',
            required: true,
            alternatives: [{ category: 'feculent', label: 'Pates' }],
          },
        ],
      },
      dailyRules: [],
    });
    const cat = (out.slots.breakfast as Array<{ alternatives: Array<{ category: string }> }>)[0]
      ?.alternatives[0]?.category;
    expect(cat).toBe('feculent');
  });

  it('ignore un slot non-array proprement', () => {
    const out = normalizeParsedDietPlan({
      slots: { breakfast: 'pas un tableau' as unknown },
      dailyRules: [],
    });
    expect(out.slots.breakfast).toBeUndefined();
  });
});
