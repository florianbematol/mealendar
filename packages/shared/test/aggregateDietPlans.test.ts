/**
 * Tests pour `aggregateDietPlansForSlot` :
 * - Agregation correcte de qty pour 2 membres avec memes labels
 * - Union regimes/allergies
 * - Comportement avec slot inexistant
 * - Membres sans diet plan
 */
import { describe, expect, it } from 'vitest';
import { type DietPlan, type UserDietPlan, aggregateDietPlansForSlot } from '../src/index.js';

function makePlan(opts: {
  userId: string;
  dietPlan: DietPlan;
  regimes?: UserDietPlan['regimes'];
  allergies?: string[];
}): UserDietPlan {
  return {
    id: opts.userId,
    userId: opts.userId,
    userEmail: null,
    householdId: 'h-1',
    dietPlan: opts.dietPlan,
    regimes: opts.regimes ?? [],
    allergies: opts.allergies ?? [],
    goals: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('aggregateDietPlansForSlot', () => {
  it('additionne les qty pour 2 membres avec meme label/categorie/unite', () => {
    const planA = makePlan({
      userId: 'u-a',
      dietPlan: {
        slots: {
          dinner: [
            {
              id: 'a1',
              label: 'Feculent',
              required: true,
              alternatives: [
                {
                  category: 'feculent',
                  label: 'Riz',
                  qtyMin: 200,
                  qtyMax: 300,
                  unit: 'g',
                },
              ],
            },
          ],
        },
        dailyRules: [],
        note: null,
      },
    });
    const planB = makePlan({
      userId: 'u-b',
      dietPlan: {
        slots: {
          dinner: [
            {
              id: 'b1',
              label: 'Feculent',
              required: true,
              alternatives: [
                {
                  category: 'feculent',
                  label: 'Riz',
                  qtyMin: 100,
                  qtyMax: 150,
                  unit: 'g',
                },
              ],
            },
          ],
        },
        dailyRules: [],
        note: null,
      },
    });

    const agg = aggregateDietPlansForSlot([planA, planB], 'dinner');

    expect(agg.memberCount).toBe(2);
    expect(agg.components).toHaveLength(1);
    const comp = agg.components[0];
    expect(comp).toBeDefined();
    if (!comp) return;
    expect(comp.label).toBe('Feculent');
    expect(comp.required).toBe(true);
    expect(comp.alternatives).toHaveLength(1);
    expect(comp.alternatives[0]?.qtyMin).toBe(300);
    expect(comp.alternatives[0]?.qtyMax).toBe(450);
    expect(comp.alternatives[0]?.unit).toBe('g');
  });

  it('garde les alternatives separees si categories differentes', () => {
    const planA = makePlan({
      userId: 'u-a',
      dietPlan: {
        slots: {
          lunch: [
            {
              id: 'a1',
              label: 'Proteine',
              required: true,
              alternatives: [
                { category: 'viande', label: 'Viande', qtyMin: 200, qtyMax: 250, unit: 'g' },
              ],
            },
          ],
        },
        dailyRules: [],
        note: null,
      },
    });
    const planB = makePlan({
      userId: 'u-b',
      dietPlan: {
        slots: {
          lunch: [
            {
              id: 'b1',
              label: 'Proteine',
              required: true,
              alternatives: [
                { category: 'poisson', label: 'Poisson', qtyMin: 150, qtyMax: 200, unit: 'g' },
              ],
            },
          ],
        },
        dailyRules: [],
        note: null,
      },
    });

    const agg = aggregateDietPlansForSlot([planA, planB], 'lunch');
    expect(agg.components).toHaveLength(1);
    const comp = agg.components[0];
    if (!comp) return;
    expect(comp.alternatives).toHaveLength(2);
    const cats = comp.alternatives.map((a) => a.category).sort();
    expect(cats).toEqual(['poisson', 'viande']);
  });

  it("flag required = true si AU MOINS un membre l'exige", () => {
    const planA = makePlan({
      userId: 'u-a',
      dietPlan: {
        slots: {
          breakfast: [
            {
              id: 'a1',
              label: 'Fruit',
              required: false,
              alternatives: [
                { category: 'fruit', label: 'Fruit', qtyMin: 1, qtyMax: 1, unit: 'piece' },
              ],
            },
          ],
        },
        dailyRules: [],
        note: null,
      },
    });
    const planB = makePlan({
      userId: 'u-b',
      dietPlan: {
        slots: {
          breakfast: [
            {
              id: 'b1',
              label: 'Fruit',
              required: true,
              alternatives: [
                { category: 'fruit', label: 'Fruit', qtyMin: 1, qtyMax: 2, unit: 'piece' },
              ],
            },
          ],
        },
        dailyRules: [],
        note: null,
      },
    });

    const agg = aggregateDietPlansForSlot([planA, planB], 'breakfast');
    expect(agg.components[0]?.required).toBe(true);
  });

  it('union des regimes et allergies', () => {
    const planA = makePlan({
      userId: 'u-a',
      dietPlan: { slots: {}, dailyRules: [], note: null },
      regimes: ['vegetarian'],
      allergies: ['arachide'],
    });
    const planB = makePlan({
      userId: 'u-b',
      dietPlan: { slots: {}, dailyRules: [], note: null },
      regimes: ['gluten_free'],
      allergies: ['lactose'],
    });

    const agg = aggregateDietPlansForSlot([planA, planB], 'dinner');
    expect(agg.regimes.sort()).toEqual(['gluten_free', 'vegetarian']);
    expect(agg.allergies.sort()).toEqual(['arachide', 'lactose']);
  });

  it('lowercase les allergies', () => {
    const planA = makePlan({
      userId: 'u-a',
      dietPlan: { slots: {}, dailyRules: [], note: null },
      allergies: ['ARACHIDE', 'Lactose'],
    });
    const agg = aggregateDietPlansForSlot([planA], 'dinner');
    expect(agg.allergies.sort()).toEqual(['arachide', 'lactose']);
  });

  it('retourne un agregat vide si aucun plan', () => {
    const agg = aggregateDietPlansForSlot([], 'dinner');
    expect(agg.components).toEqual([]);
    expect(agg.regimes).toEqual([]);
    expect(agg.allergies).toEqual([]);
    expect(agg.memberCount).toBe(0);
  });

  it('ignore les slots non mentionnes par les membres', () => {
    const planA = makePlan({
      userId: 'u-a',
      dietPlan: {
        slots: {
          lunch: [
            {
              id: 'a1',
              label: 'Legume',
              required: true,
              alternatives: [
                { category: 'legumes', label: 'Legumes', qtyMin: 200, qtyMax: 300, unit: 'g' },
              ],
            },
          ],
        },
        dailyRules: [],
        note: null,
      },
    });
    const agg = aggregateDietPlansForSlot([planA], 'breakfast');
    expect(agg.components).toEqual([]);
  });

  it('groupe par label case-insensitive et trim', () => {
    const planA = makePlan({
      userId: 'u-a',
      dietPlan: {
        slots: {
          dinner: [
            {
              id: 'a1',
              label: 'Proteine',
              required: true,
              alternatives: [
                { category: 'viande', label: 'Viande', qtyMin: 100, qtyMax: 100, unit: 'g' },
              ],
            },
          ],
        },
        dailyRules: [],
        note: null,
      },
    });
    const planB = makePlan({
      userId: 'u-b',
      dietPlan: {
        slots: {
          dinner: [
            {
              id: 'b1',
              label: '  PROTEINE  ',
              required: false,
              alternatives: [
                { category: 'viande', label: 'Viande', qtyMin: 50, qtyMax: 50, unit: 'g' },
              ],
            },
          ],
        },
        dailyRules: [],
        note: null,
      },
    });
    const agg = aggregateDietPlansForSlot([planA, planB], 'dinner');
    expect(agg.components).toHaveLength(1);
    expect(agg.components[0]?.alternatives[0]?.qtyMin).toBe(150);
    expect(agg.components[0]?.alternatives[0]?.qtyMax).toBe(150);
  });
});
