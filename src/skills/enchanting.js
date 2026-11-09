import { skillRegistry } from './registry.js'

function count(bot, name) {
  return (bot.inventory?.items?.() ?? []).filter((item) => item.name === name).reduce((sum, item) => sum + item.count, 0)
}

function findItem(bot, name) {
  return bot.inventory?.items?.().find((item) => !name || item.name === name || item.name.includes(name))
}

skillRegistry.register({
  id: 'inspect_enchanting_options',
  name: 'Inspect Enchanting Options',
  category: 'crafting',
  description: 'Read actual enchanting-table choices for an item without enchanting it',
  arguments: { itemName: { type: 'string', required: false }, radius: { type: 'number', required: false, default: 6 } },
  timeout: 20000,
  async execute(bot, args) {
    const tableDef = bot.registry?.blocksByName?.enchanting_table
    const tableBlock = tableDef ? bot.findBlock({ matching: tableDef.id, maxDistance: args.radius ?? 6 }) : null
    if (!tableBlock) return { success: false, error: 'No enchanting table found within range' }
    const item = findItem(bot, args.itemName)
    if (!item) return { success: false, error: 'No matching enchantable item in inventory' }
    if (count(bot, 'lapis_lazuli') < 1) return { success: false, error: 'No lapis lazuli available' }
    if (typeof bot.openEnchantmentTable !== 'function') return { success: false, error: 'Enchanting API unavailable in this Mineflayer version' }
    const table = await bot.openEnchantmentTable(tableBlock)
    try {
      await table.putTargetItem(item)
      const lapis = findItem(bot, 'lapis_lazuli')
      if (lapis) await table.putLapis(lapis)
      await new Promise((resolve) => table.enchantments?.[0]?.level >= 0 ? resolve() : table.once('ready', resolve))
      return { success: true, item: item.name, options: table.enchantments.map((choice, index) => ({ index, level: choice.level, expectedEnchant: choice.expected.enchant, expectedLevel: choice.expected.level })) }
    } finally {
      await table.takeTargetItem?.().catch?.(() => {})
      await table.close?.()
    }
  },
})

skillRegistry.register({
  id: 'enchant_item',
  name: 'Enchant Item',
  category: 'crafting',
  description: 'Enchant an inventory item at a real enchanting table and verify enchantments were added',
  arguments: { itemName: { type: 'string', required: false }, choice: { type: 'number', required: false, default: 0 }, radius: { type: 'number', required: false, default: 6 } },
  timeout: 30000,
  async execute(bot, args) {
    const tableDef = bot.registry?.blocksByName?.enchanting_table
    const tableBlock = tableDef ? bot.findBlock({ matching: tableDef.id, maxDistance: args.radius ?? 6 }) : null
    const item = findItem(bot, args.itemName)
    if (!tableBlock) return { success: false, error: 'No enchanting table found within range' }
    if (!item) return { success: false, error: 'No matching item in inventory' }
    if (count(bot, 'lapis_lazuli') < 1) return { success: false, error: 'No lapis lazuli available' }
    if (typeof bot.openEnchantmentTable !== 'function') return { success: false, error: 'Enchanting API unavailable in this Mineflayer version' }
    const before = item.enchants?.length ?? 0
    const table = await bot.openEnchantmentTable(tableBlock)
    try {
      await table.putTargetItem(item)
      const lapis = findItem(bot, 'lapis_lazuli')
      await table.putLapis(lapis)
      const selected = Math.max(0, Math.min(2, Math.floor(args.choice ?? 0)))
      const enchanted = await table.enchant(selected)
      const after = enchanted?.enchants?.length ?? 0
      if (after <= before) return { success: false, error: 'Enchanting completed without a verified enchantment increase', before, after }
      return { success: true, item: enchanted.name, choice: selected, enchantmentsAdded: after - before, enchantments: enchanted.enchants }
    } finally {
      await table.close?.()
    }
  },
})
