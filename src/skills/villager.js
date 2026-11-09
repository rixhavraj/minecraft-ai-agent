import { skillRegistry } from './registry.js'

function nearestVillager(bot, maxDistance) {
  return Object.values(bot.entities ?? {})
    .filter((entity) => entity.name === 'villager' && entity.position)
    .map((entity) => ({ entity, distance: bot.entity.position.distanceTo(entity.position) }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)[0]?.entity ?? null
}

function inventoryCount(bot, itemName) {
  return (bot.inventory?.items?.() ?? []).filter((item) => item.name === itemName).reduce((sum, item) => sum + item.count, 0)
}

skillRegistry.register({
  id: 'inspect_villagers',
  name: 'Inspect Nearby Villagers',
  category: 'world_management',
  description: 'Observe nearby villagers and their professions without changing world state',
  arguments: { radius: { type: 'number', required: false, default: 16 } },
  timeout: 10000,
  async execute(bot, args) {
    const radius = Math.min(args.radius ?? 16, 64)
    const villagers = Object.values(bot.entities ?? [])
      .filter((entity) => entity.name === 'villager' && entity.position)
      .map((entity) => ({
        id: entity.id,
        distance: Number(bot.entity.position.distanceTo(entity.position).toFixed(2)),
        position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
        profession: entity.metadata?.find?.((value) => typeof value === 'string' && value.includes('minecraft:')) ?? null,
      }))
      .filter((villager) => villager.distance <= radius)
    return { success: true, count: villagers.length, villagers }
  },
})

skillRegistry.register({
  id: 'trade_with_villager',
  name: 'Trade With Villager',
  category: 'world_management',
  description: 'Execute a selected real villager trade and verify the output inventory delta',
  arguments: {
    tradeIndex: { type: 'number', required: true, description: 'Zero-based trade index' },
    count: { type: 'number', required: false, default: 1, description: 'Number of trades' },
    radius: { type: 'number', required: false, default: 4 },
  },
  timeout: 30000,
  async execute(bot, args) {
    const villager = nearestVillager(bot, args.radius ?? 4)
    if (!villager) return { success: false, error: 'No villager is visible within range' }
    if (typeof bot.openVillager !== 'function') return { success: false, error: 'Villager trading is unavailable in this Mineflayer version' }
    const index = Math.max(0, Math.floor(args.tradeIndex))
    const count = Math.max(1, Math.floor(args.count ?? 1))
    const window = await bot.openVillager(villager)
    try {
      const trade = window.trades?.[index]
      if (!trade) return { success: false, error: `Villager has no trade at index ${index}` }
      if (trade.disabled) return { success: false, error: `Trade ${index} is disabled` }
      const output = trade.outputItem ?? trade.outputs?.[0]
      if (!output?.name) return { success: false, error: `Trade ${index} exposes no verifiable output` }
      const before = inventoryCount(bot, output.name)
      const available = Math.max(0, (trade.maximumNbTradeUses ?? trade.maxUses ?? count) - (trade.nbTradeUses ?? trade.tradeUses ?? 0))
      const actualCount = Math.min(count, available || count)
      await window.trade(index, actualCount)
      await new Promise((resolve) => setTimeout(resolve, 500))
      const after = inventoryCount(bot, output.name)
      const gained = after - before
      if (gained <= 0) return { success: false, error: 'Trade completed without a verified output inventory increase', output: output.name, before, after }
      return { success: true, tradeIndex: index, requestedCount: count, completedCount: actualCount, output: output.name, gained, before, after }
    } finally {
      await window.close?.()
    }
  },
})

skillRegistry.register({
  id: 'inspect_villager_trades',
  name: 'Inspect Villager Trades',
  category: 'world_management',
  description: 'Open the nearest villager and return the trades Mineflayer exposes; does not trade',
  arguments: { radius: { type: 'number', required: false, default: 4 } },
  timeout: 20000,
  async execute(bot, args) {
    const villager = nearestVillager(bot, args.radius ?? 4)
    if (!villager) return { success: false, error: 'No villager is visible within range' }
    if (typeof bot.openVillager !== 'function') return { success: false, error: 'This Mineflayer version does not expose villager trading' }
    const window = await bot.openVillager(villager)
    try {
      const trades = (window.trades ?? []).map((trade, index) => ({
        index,
        disabled: Boolean(trade.disabled),
        input1: trade.inputItem1 ? { name: trade.inputItem1.name, count: trade.inputItem1.count } : null,
        input2: trade.inputItem2 ? { name: trade.inputItem2.name, count: trade.inputItem2.count } : null,
        output: trade.outputItem ? { name: trade.outputItem.name, count: trade.outputItem.count } : null,
        uses: trade.tradeUses ?? null,
        maxUses: trade.maxUses ?? null,
      }))
      return { success: true, villagerId: villager.id, trades }
    } finally {
      window.close?.()
    }
  },
})
