const SAME_FAILURE_LIMIT = 2
const attempts = new Map()

export function analyzeCraftingFailure({ itemName, code, message, strategy = 'default' }) {
  const key = `${itemName}:${code}:${strategy}`
  const count = (attempts.get(key) ?? 0) + 1
  attempts.set(key, count)
  return {
    itemName,
    code,
    message,
    attempt: count,
    retryAllowed: count < SAME_FAILURE_LIMIT,
    requiresHumanHelp: count >= SAME_FAILURE_LIMIT || ['INVALID_ITEM', 'RECIPE_UNAVAILABLE', 'CIRCULAR_RECIPE'].includes(code),
  }
}

export function resetCraftingFailure(itemName, code) {
  for (const key of attempts.keys()) if (key.startsWith(`${itemName}:${code}:`)) attempts.delete(key)
}
