import { memoryStore } from '../../database/memory_store.js'

export function normalizeItemName(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^(?:an?|the)\s+/, '').replace(/[ -]+/g, '_')
}

export function inventoryCounts(bot) {
  const counts = new Map()
  for (const item of bot?.inventory?.items?.() ?? []) counts.set(item.name, (counts.get(item.name) ?? 0) + item.count)
  return counts
}

export function rememberRecipe(recipe, { verified = false, source = 'minecraft-data', taskId = null } = {}) {
  return memoryStore.recordExperience({
    kind: 'procedural',
    content: JSON.stringify({ type: 'crafting_recipe', recipe, verified, source, taskId, recordedAt: new Date().toISOString() }),
    taskId,
    verified,
    source,
    importance: verified ? 2 : 1,
  })
}

export function learnedRecipes(itemName, { verifiedOnly = true } = {}) {
  const needle = normalizeItemName(itemName)
  return memoryStore.retrieveExperiences({ query: needle, kinds: ['procedural'], verifiedOnly, limit: 20 })
    .map((row) => {
      try { return { ...row, procedure: JSON.parse(row.content)?.content ? JSON.parse(row.content).content : JSON.parse(row.content) } } catch { return null }
    })
    .filter(Boolean)
}
