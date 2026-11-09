import { normalizeItemName, inventoryCounts } from './recipeKnowledge.js'

function nameFromId(mcData, id) {
  return mcData.items?.[id]?.name ?? Object.values(mcData.itemsByName ?? {}).find((item) => item.id === id)?.name ?? null
}

export function resolveRecipe(bot, mcData, requestedName, craftingTable = null) {
  const itemName = normalizeItemName(requestedName)
  const definition = mcData.itemsByName[itemName]
  if (!definition) return { ok: false, code: 'INVALID_ITEM', itemName }
  const recipe = bot.recipesFor(definition.id, null, 1, craftingTable)?.[0] ?? null
  if (!recipe) return { ok: false, code: craftingTable ? 'RECIPE_UNAVAILABLE' : 'MISSING_CRAFTING_TABLE', itemName }
  const ingredients = new Map()
  for (const ingredient of recipe.ingredients ?? []) {
    const name = nameFromId(mcData, ingredient.id)
    if (name) ingredients.set(name, (ingredients.get(name) ?? 0) + (ingredient.count ?? 1))
  }
  return {
    ok: true,
    itemName,
    recipe,
    outputQuantity: recipe.result?.count ?? 1,
    ingredients: [...ingredients.entries()].map(([name, count]) => ({ name, count })),
    inventory: Object.fromEntries(inventoryCounts(bot)),
    requiresCraftingTable: Boolean(craftingTable),
  }
}
