import { resolveRecipe } from './recipeResolver.js'
import { inventoryCounts, normalizeItemName } from './recipeKnowledge.js'

export function planPrerequisites(bot, mcData, requestedName, quantity = 1, stack = []) {
  const itemName = normalizeItemName(requestedName)
  if (stack.includes(itemName)) return { ok: false, code: 'CIRCULAR_RECIPE', path: [...stack, itemName] }
  const counts = inventoryCounts(bot)
  if ((counts.get(itemName) ?? 0) >= quantity) return { ok: true, itemName, steps: [] }
  const direct = resolveRecipe(bot, mcData, itemName, null)
  const table = direct.ok ? null : bot.findBlock ? bot.findBlock({ matching: mcData.blocksByName.crafting_table?.id, maxDistance: 16 }) : null
  const resolved = direct.ok ? direct : resolveRecipe(bot, mcData, itemName, table)
  if (!resolved.ok) return { ok: false, code: resolved.code, itemName }
  const batches = Math.max(1, Math.ceil((quantity - (counts.get(itemName) ?? 0)) / resolved.outputQuantity))
  const steps = []
  for (const ingredient of resolved.ingredients) {
    const child = planPrerequisites(bot, mcData, ingredient.name, ingredient.count * batches, [...stack, itemName])
    if (!child.ok) return child
    steps.push(...child.steps)
  }
  steps.push({ type: 'craft', itemName, quantity: batches, requiresCraftingTable: resolved.requiresCraftingTable })
  return { ok: true, itemName, steps }
}
