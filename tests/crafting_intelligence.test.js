import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveRecipe } from '../src/intelligence/crafting/recipeResolver.js'
import { analyzeCraftingFailure } from '../src/intelligence/crafting/craftingFailureAnalyzer.js'

const mcData = {
  itemsByName: {
    chest: { id: 1 }, acacia_planks: { id: 2 }, stick: { id: 3 }, cobblestone: { id: 4 }, stone_pickaxe: { id: 5 },
  },
  items: [{}, { name: 'chest' }, { name: 'acacia_planks' }, { name: 'stick' }, { name: 'cobblestone' }, { name: 'stone_pickaxe' }],
}

test('recipe resolver reads version recipe ingredients and quantities', () => {
  const bot = { recipesFor: () => [{ result: { count: 1 }, ingredients: [{ id: 2, count: 8 }] }] }
  const result = resolveRecipe(bot, mcData, 'chest', {})
  assert.equal(result.ok, true)
  assert.deepEqual(result.ingredients, [{ name: 'acacia_planks', count: 8 }])
  assert.equal(result.requiresCraftingTable, true)
})

test('crafting failure analyzer bounds unchanged retries', () => {
  const first = analyzeCraftingFailure({ itemName: 'observer', code: 'RECIPE_UNAVAILABLE', message: 'unknown' })
  const second = analyzeCraftingFailure({ itemName: 'observer', code: 'RECIPE_UNAVAILABLE', message: 'unknown' })
  assert.equal(first.retryAllowed, true)
  assert.equal(second.retryAllowed, false)
  assert.equal(second.requiresHumanHelp, true)
})
