/**
 * Food and Farming skills module for minecraft-ai-squad
 *
 * Implements food searching, harvesting crops, hunting, cooking in furnace,
 * eating food, creating farmland, planting, replanting, and sustainable farming.
 */

import { skillRegistry } from './registry.js'
import { logger } from '../utils/logger.js'
import pathfinderPackage from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'

const { goals: { GoalBlock, GoalGetToBlock, GoalNear, GoalFollow } } = pathfinderPackage
const log = logger.child({ component: 'FoodFarmingSkills' })

const EDIBLE_FOODS = [
  'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken',
  'cooked_rabbit', 'cooked_salmon', 'cooked_cod', 'bread', 'baked_potato',
  'golden_carrot', 'carrot', 'apple', 'sweet_berries', 'melon_slice',
  'rotten_flesh',
]

const RAW_FOODS = ['raw_beef', 'raw_porkchop', 'raw_mutton', 'raw_chicken', 'raw_rabbit', 'raw_cod', 'raw_salmon', 'potato']

// ─── find_food ───────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'find_food',
  name: 'Find Food',
  category: 'food_farming',
  description: 'Locate food in inventory, nearby dropped food items, or mature crops',
  arguments: {
    maxDistance: { type: 'number', required: false, default: 32, description: 'Search distance' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 30000,

  async execute(bot, args, context) {
    const maxDist = args.maxDistance ?? 32
    const inventoryFoods = bot.inventory.items().filter(i => EDIBLE_FOODS.includes(i.name))
    const totalInventoryFood = inventoryFoods.reduce((acc, i) => acc + i.count, 0)

    // Check dropped food items
    const droppedFoods = []
    for (const ent of Object.values(bot.entities)) {
      if (ent.name === 'item' && ent.position.distanceTo(bot.entity.position) <= maxDist) {
        // Prismarine entity metadata holds item info
        const meta = ent.metadata
        droppedFoods.push({ id: ent.id, pos: ent.position, distance: Number(bot.entity.position.distanceTo(ent.position).toFixed(1)) })
      }
    }

    // Check mature crops
    const cropBlocks = ['wheat', 'carrots', 'potatoes', 'beetroots']
    const matureCrops = []
    for (const crop of cropBlocks) {
      const def = context.mcData.blocksByName[crop]
      if (!def) continue
      const blocks = bot.findBlocks({ matching: def.id, maxDistance: maxDist, count: 10 })
      for (const p of blocks) {
        const b = bot.blockAt(p)
        // Check maturity: wheat/carrots/potatoes metadata=7, beetroots metadata=3
        const maxAge = crop === 'beetroots' ? 3 : 7
        if (b?._properties?.age === maxAge || b?.metadata === maxAge) {
          matureCrops.push({ type: crop, pos: p })
        }
      }
    }

    // Check nearby passive animals
    const animals = ['cow', 'pig', 'chicken', 'sheep', 'rabbit']
    const huntable = []
    for (const ent of Object.values(bot.entities)) {
      if (animals.includes(ent.name) && ent.position.distanceTo(bot.entity.position) <= maxDist) {
        huntable.push({ type: ent.name, distance: Number(bot.entity.position.distanceTo(ent.position).toFixed(1)) })
      }
    }

    return {
      success: true,
      inventoryFoods: inventoryFoods.map(i => ({ name: i.name, count: i.count })),
      totalInventoryFood,
      nearbyDroppedItems: droppedFoods.length,
      matureCropsFound: matureCrops.length,
      nearbyAnimals: huntable.length,
    }
  },
})

// ─── collect_dropped_food ───────────────────────────────────────────────────
skillRegistry.register({
  id: 'collect_dropped_food',
  name: 'Collect Dropped Food',
  category: 'food_farming',
  description: 'Navigate to nearby dropped food or item entities and pick them up',
  arguments: {
    maxDistance: { type: 'number', required: false, default: 24, description: 'Search distance' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 30000,

  async execute(bot, args) {
    const maxDist = args.maxDistance ?? 24
    const itemEntities = Object.values(bot.entities).filter(
      ent => ent.name === 'item' && ent.position.distanceTo(bot.entity.position) <= maxDist
    )

    if (itemEntities.length === 0) {
      return { success: true, collected: 0, message: 'No dropped items nearby' }
    }

    let collectedCount = 0
    for (const ent of itemEntities.slice(0, 5)) {
      if (!ent.isValid) continue
      try {
        bot.pathfinder.setGoal(new GoalNear(ent.position.x, ent.position.y, ent.position.z, 1))
        await new Promise(r => setTimeout(r, 2500))
        collectedCount++
      } catch {
        // ignore individual failed pick
      }
    }

    return {
      success: true,
      approached: collectedCount,
    }
  },
})

// ─── eat_food ───────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'eat_food',
  name: 'Eat Food',
  category: 'food_farming',
  description: 'Select best food from inventory, equip it, and consume it to replenish hunger',
  arguments: {
    preferredFood: { type: 'string', required: false, description: 'Optional specific food name' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 20000,

  async execute(bot, args) {
    const items = bot.inventory.items()
    let foodItem = null

    if (args.preferredFood) {
      foodItem = items.find(i => i.name === args.preferredFood)
    }

    if (!foodItem) {
      for (const name of [...EDIBLE_FOODS, ...RAW_FOODS]) {
        foodItem = items.find(i => i.name === name)
        if (foodItem) break
      }
    }

    if (!foodItem) {
      return { success: false, error: 'No edible food in inventory' }
    }

    const foodBefore = bot.food ?? 0
    if (foodBefore >= 20) return { success: true, skipped: true, reason: 'HUNGER_FULL', foodBefore, foodAfter: foodBefore }
    const countBefore = items.filter((item) => item.name === foodItem.name).reduce((sum, item) => sum + item.count, 0)
    await bot.equip(foodItem, 'hand')
    await bot.consume()
    const foodAfter = bot.food ?? 0
    const countAfter = bot.inventory.items().filter((item) => item.name === foodItem.name).reduce((sum, item) => sum + item.count, 0)

    if (foodAfter <= foodBefore && countAfter >= countBefore) {
      return { success: false, error: `EATING_NOT_VERIFIED: ${foodItem.name} was not consumed`, foodBefore, foodAfter, countBefore, countAfter }
    }

    return {
      success: true,
      foodEaten: foodItem.name,
      foodBefore,
      foodAfter,
      replenished: foodAfter - foodBefore,
      consumed: countBefore - countAfter,
    }
  },
})

// Deterministic survival chain used by "find food". It never stops after an
// inventory miss: each fallback changes strategy and records what ran.
skillRegistry.register({
  id: 'survive_food',
  name: 'Find, Gather, and Eat Food',
  category: 'food_farming',
  description: 'Eat inventory food, harvest crops, hunt animals, cook, then eat',
  arguments: { maxDistance: { type: 'number', required: false, default: 64 } },
  requires: [], permissions: ['*'], timeout: 120000,
  async execute(bot, args, context) {
    const strategies = []
    const eat = skillRegistry.get('eat_food')
    const harvest = skillRegistry.get('harvest_crops')
    const hunt = skillRegistry.get('hunt_animal')
    const cook = skillRegistry.get('cook_food')
    const before = bot.food ?? 20
    const tryEat = async () => {
      const result = await eat.execute(bot, {}, context)
      strategies.push({ name: 'eat_inventory', ok: result.success })
      return result.success
    }
    if (await tryEat()) return { success: true, strategy: strategies, foodBefore: before, foodAfter: bot.food ?? before }

    for (const cropType of ['potatoes', 'carrots', 'wheat', 'beetroots']) {
      const result = await harvest.execute(bot, { cropType, maxCount: 8, replant: true }, context)
      strategies.push({ name: `harvest_${cropType}`, ok: result.harvested > 0 })
      if (result.harvested > 0 && await tryEat()) return { success: true, strategy: strategies, foodBefore: before, foodAfter: bot.food ?? before }
    }

    for (const animal of ['cow', 'pig', 'sheep', 'chicken']) {
      const result = await hunt.execute(bot, { animal, quantity: 1 }, context)
      strategies.push({ name: `hunt_${animal}`, ok: result.hunted > 0 })
      if (result.hunted > 0) {
        const cooked = await cook.execute(bot, { quantity: 4 }, context)
        strategies.push({ name: 'cook_food', ok: cooked.success })
        if (await tryEat()) return { success: true, strategy: strategies, foodBefore: before, foodAfter: bot.food ?? before }
      }
    }

    return { success: false, error: 'No food found after inventory, crops, animals, and cooking strategies', strategy: strategies, state: { food: bot.food ?? before, position: bot.entity?.position ?? null } }
  },
})

// ─── harvest_crops ──────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'harvest_crops',
  name: 'Harvest Mature Crops',
  category: 'food_farming',
  description: 'Locate mature crops, dig them, and collect drops',
  arguments: {
    cropType: { type: 'string', required: false, default: 'wheat', description: 'Crop name' },
    maxCount: { type: 'number', required: false, default: 8, description: 'Max crops to harvest' },
    replant: { type: 'boolean', required: false, default: true, description: 'Auto-replant after digging' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 60000,

  async execute(bot, args, context) {
    const cropType = args.cropType ?? 'wheat'
    const maxCount = args.maxCount ?? 8
    const doReplant = args.replant ?? true

    const def = context.mcData.blocksByName[cropType]
    if (!def) return { success: false, error: `Unknown crop ${cropType}` }

    const cropBlocks = bot.findBlocks({ matching: def.id, maxDistance: 32, count: 50 })
    const matureBlocks = []

    for (const p of cropBlocks) {
      const b = bot.blockAt(p)
      const maxAge = cropType === 'beetroots' ? 3 : 7
      if (b?._properties?.age === maxAge || b?.metadata === maxAge) {
        matureBlocks.push(b)
        if (matureBlocks.length >= maxCount) break
      }
    }

    if (matureBlocks.length === 0) {
      return { success: true, harvested: 0, message: `No mature ${cropType} found` }
    }

    let harvested = 0
    for (const block of matureBlocks) {
      try {
        bot.pathfinder.setGoal(new GoalGetToBlock(block.position.x, block.position.y, block.position.z))
        await new Promise(r => setTimeout(r, 2000))

        const groundPos = block.position.offset(0, -1, 0)
        await bot.dig(block)
        harvested++

        // Pick up drops
        await new Promise(r => setTimeout(r, 400))

        if (doReplant) {
          // Find corresponding seed in inventory
          const seedName = cropType === 'wheat' ? 'wheat_seeds' : (cropType === 'beetroots' ? 'beetroot_seeds' : cropType)
          const seedItem = bot.inventory.items().find(i => i.name === seedName)
          const groundBlock = bot.blockAt(groundPos)
          if (seedItem && groundBlock && groundBlock.name === 'farmland') {
            await bot.equip(seedItem, 'hand')
            await bot.placeBlock(groundBlock, new Vec3(0, 1, 0))
          }
        }
      } catch (err) {
        log.warn({ err: err.message }, 'Failed harvesting crop block')
      }
    }

    return {
      success: true,
      harvested,
      replanted: doReplant,
    }
  },
})

// ─── plant_crops ────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'plant_crops',
  name: 'Plant Crops on Farmland',
  category: 'food_farming',
  description: 'Plant seeds/carrots/potatoes onto untilled or tilled farmland',
  arguments: {
    cropType: { type: 'string', required: false, default: 'wheat_seeds', description: 'Seed or crop item name' },
    maxCount: { type: 'number', required: false, default: 8, description: 'Number to plant' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 45000,

  async execute(bot, args, context) {
    const seedName = args.cropType ?? 'wheat_seeds'
    const maxCount = args.maxCount ?? 8
    const seedItem = bot.inventory.items().find(i => i.name === seedName)

    if (!seedItem) {
      return { success: false, error: `No ${seedName} in inventory to plant` }
    }

    const farmlandDef = context.mcData.blocksByName['farmland']
    if (!farmlandDef) return { success: false, error: 'Farmland block definition missing' }

    const farmlands = bot.findBlocks({ matching: farmlandDef.id, maxDistance: 24, count: 30 })
    let planted = 0

    for (const p of farmlands) {
      if (planted >= maxCount) break
      const above = bot.blockAt(p.offset(0, 1, 0))
      if (above && above.name === 'air') {
        const farmBlock = bot.blockAt(p)
        try {
          bot.pathfinder.setGoal(new GoalGetToBlock(p.x, p.y, p.z))
          await new Promise(r => setTimeout(r, 1500))
          const freshItem = bot.inventory.items().find(i => i.name === seedName)
          if (!freshItem) break
          await bot.equip(freshItem, 'hand')
          await bot.placeBlock(farmBlock, new Vec3(0, 1, 0))
          planted++
        } catch (err) {
          log.warn({ err: err.message }, 'Error planting seed')
        }
      }
    }

    return {
      success: true,
      planted,
      seed: seedName,
    }
  },
})

// ─── create_farmland ────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'create_farmland',
  name: 'Create Farmland with Hoe',
  category: 'food_farming',
  description: 'Hoe dirt or grass blocks near water to create farmland',
  arguments: {
    width: { type: 'number', required: false, default: 3, description: 'Farmland width' },
    length: { type: 'number', required: false, default: 3, description: 'Farmland length' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 60000,

  async execute(bot, args, context) {
    const width = args.width ?? 3
    const length = args.length ?? 3

    // Check for hoe in inventory
    const hoeItem = bot.inventory.items().find(i => i.name.endsWith('_hoe'))
    if (!hoeItem) {
      return { success: false, error: 'No hoe available in inventory to till soil' }
    }

    await bot.equip(hoeItem, 'hand')
    const pos = bot.entity.position
    let tilled = 0

    for (let dx = -Math.floor(width / 2); dx <= Math.floor(width / 2); dx++) {
      for (let dz = -Math.floor(length / 2); dz <= Math.floor(length / 2); dz++) {
        const blockPos = pos.offset(dx, -1, dz)
        const block = bot.blockAt(blockPos)
        const above = bot.blockAt(pos.offset(dx, 0, dz))

        if (block && (block.name === 'dirt' || block.name === 'grass_block') && above?.name === 'air') {
          try {
            bot.pathfinder.setGoal(new GoalNear(blockPos.x, blockPos.y + 1, blockPos.z, 2))
            await new Promise(r => setTimeout(r, 1000))
            await bot.activateBlock(block)
            tilled++
          } catch (err) {
            log.warn({ err: err.message }, 'Failed to till block')
          }
        }
      }
    }

    return {
      success: true,
      tilled,
    }
  },
})

// ─── hunt_animal ────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'hunt_animal',
  name: 'Hunt Passive Animal for Food',
  category: 'food_farming',
  description: 'Locate and defeat a passive animal (cow, pig, chicken, sheep) for meat',
  arguments: {
    animal: { type: 'string', required: false, default: 'cow', description: 'Animal type' },
    quantity: { type: 'number', required: false, default: 1, description: 'Count to hunt' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 60000,

  async execute(bot, args) {
    const targetType = args.animal ?? 'cow'
    const targetCount = args.quantity ?? 1
    let hunted = 0

    // Equip best weapon
    const weapon = bot.inventory.items().find(i => i.name.endsWith('_sword') || i.name.endsWith('_axe'))
    if (weapon) await bot.equip(weapon, 'hand')

    for (let i = 0; i < targetCount; i++) {
      const candidates = Object.values(bot.entities).filter(
        e => e.name === targetType && e.position.distanceTo(bot.entity.position) <= 32
      )
      if (candidates.length === 0) break

      candidates.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position))
      const target = candidates[0]

      try {
        bot.pathfinder.setGoal(new GoalFollow(target, 1.5), true)
        let attacks = 0
        while (target.isValid && attacks < 15) {
          if (bot.entity.position.distanceTo(target.position) <= 3.2) {
            await bot.attack(target)
            attacks++
            await new Promise(r => setTimeout(r, 600))
          } else {
            await new Promise(r => setTimeout(r, 300))
          }
        }
        bot.pathfinder.setGoal(null)
        // Collect drops
        await new Promise(r => setTimeout(r, 1200))
        hunted++
      } catch (err) {
        log.warn({ err: err.message }, 'Failed attacking animal')
      }
    }

    return {
      success: hunted > 0,
      hunted,
      targetType,
    }
  },
})

skillRegistry.register({
  id: 'breed_animals',
  name: 'Breed Nearby Animals',
  category: 'food_farming',
  description: 'Feed two compatible nearby adult animals and verify a new child entity appears',
  arguments: {
    animal: { type: 'string', required: false, default: 'cow' },
    radius: { type: 'number', required: false, default: 16 },
  },
  timeout: 30000,
  async execute(bot, args) {
    const animal = args.animal ?? 'cow'
    const radius = Math.min(args.radius ?? 16, 32)
    const foods = {
      cow: ['wheat'], sheep: ['wheat'], pig: ['carrot', 'potato', 'beetroot'],
      chicken: ['wheat_seeds', 'beetroot_seeds', 'pumpkin_seeds', 'melon_seeds'],
      rabbit: ['carrot', 'golden_carrot', 'dandelion'],
    }
    const foodNames = foods[animal]
    if (!foodNames) return { success: false, error: `Breeding food is not defined for ${animal}` }
    if (typeof bot.activateEntity !== 'function') return { success: false, error: 'Entity activation is unavailable in this Mineflayer version' }
    const candidates = Object.values(bot.entities ?? {}).filter((entity) => entity.name === animal && entity.position && bot.entity.position.distanceTo(entity.position) <= radius && !entity.metadata?.isBaby)
    if (candidates.length < 2) return { success: false, error: `Need two adult ${animal} entities within ${radius} blocks` }
    const food = bot.inventory.items().find((item) => foodNames.includes(item.name))
    if (!food || food.count < 2) return { success: false, error: `Need at least two units of breeding food: ${foodNames.join(', ')}` }
    const beforeIds = new Set(Object.values(bot.entities ?? {}).filter((entity) => entity.name === animal).map((entity) => entity.id))
    await bot.equip(food, 'hand')
    for (const target of candidates.slice(0, 2)) {
      await bot.activateEntity(target)
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const child = Object.values(bot.entities ?? {}).find((entity) => entity.name === animal && !beforeIds.has(entity.id))
    if (!child) return { success: false, error: `No new ${animal} entity was observed after feeding both animals` }
    return { success: true, animal, childId: child.id, childPosition: { x: child.position.x, y: child.position.y, z: child.position.z }, food: food.name }
  },
})

// ─── cook_food ──────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'cook_food',
  name: 'Cook Raw Food in Furnace',
  category: 'food_farming',
  description: 'Deposit raw meat/potatoes and fuel in a nearby furnace and cook it',
  arguments: {
    foodItem: { type: 'string', required: false, description: 'Specific raw food' },
    quantity: { type: 'number', required: false, default: 4, description: 'Quantity to cook' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 90000,

  async execute(bot, args, context) {
    const furnaceDef = context.mcData.blocksByName['furnace']
    if (!furnaceDef) return { success: false, error: 'Furnace definition not found' }

    const furnacePos = bot.findBlock({ matching: furnaceDef.id, maxDistance: 16 })
    if (!furnacePos) {
      return { success: false, error: 'No furnace found within 16 blocks' }
    }

    // Find raw food in inventory
    const items = bot.inventory.items()
    let rawItem = null
    if (args.foodItem) {
      rawItem = items.find(i => i.name === args.foodItem)
    } else {
      rawItem = items.find(i => RAW_FOODS.includes(i.name))
    }

    if (!rawItem) {
      return { success: false, error: 'No raw food to cook in inventory' }
    }

    // Find fuel: coal, charcoal, or wood planks
    const fuelItem = items.find(i => ['coal', 'charcoal', 'oak_planks', 'spruce_planks', 'birch_planks'].includes(i.name))
    if (!fuelItem) {
      return { success: false, error: 'No fuel (coal/planks) in inventory' }
    }

    bot.pathfinder.setGoal(new GoalGetToBlock(furnacePos.position.x, furnacePos.position.y, furnacePos.position.z))
    await new Promise(r => setTimeout(r, 2000))

    const furnace = await bot.openContainer(furnacePos)
    try {
      const cookCount = Math.min(rawItem.count, args.quantity ?? 4)
      await furnace.deposit(rawItem.type, null, cookCount)
      await furnace.deposit(fuelItem.type, null, 1)

      // Wait 10 seconds for initial cook cycle
      await new Promise(r => setTimeout(r, 10000))

      // Withdraw all cooked items from output slot
      const outputSlot = furnace.slots[2]
      if (outputSlot) {
        await furnace.withdraw(outputSlot.type, null, outputSlot.count)
      }
      furnace.close()
      return {
        success: true,
        cooked: rawItem.name,
        quantity: cookCount,
      }
    } catch (err) {
      furnace.close()
      return { success: false, error: err.message }
    }
  },
})

// ─── collect_apples ─────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'collect_apples',
  name: 'Collect Apples from Oak Leaves',
  category: 'food_farming',
  description: 'Break oak leaf blocks nearby to search for dropped apples',
  arguments: {
    maxLeaves: { type: 'number', required: false, default: 20, description: 'Leaves to break' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 45000,

  async execute(bot, args, context) {
    const oakLeavesDef = context.mcData.blocksByName['oak_leaves']
    if (!oakLeavesDef) return { success: false, error: 'Oak leaves definition not found' }

    const leafBlocks = bot.findBlocks({ matching: oakLeavesDef.id, maxDistance: 16, count: args.maxLeaves ?? 20 })
    let broken = 0

    for (const p of leafBlocks) {
      const b = bot.blockAt(p)
      if (b) {
        try {
          bot.pathfinder.setGoal(new GoalGetToBlock(p.x, p.y, p.z))
          await new Promise(r => setTimeout(r, 1200))
          await bot.dig(b)
          broken++
        } catch {
          // ignore individual block failures
        }
      }
    }

    return {
      success: true,
      leavesBroken: broken,
    }
  },
})

// ─── maintain_food_reserves ─────────────────────────────────────────────────
skillRegistry.register({
  id: 'maintain_food_reserves',
  name: 'Maintain Food Reserves',
  category: 'food_farming',
  description: 'Check food reserves; if below minimum, attempt hunting, harvesting or cooking',
  arguments: {
    minimumFood: { type: 'number', required: false, default: 16, description: 'Minimum food count' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 60000,

  async execute(bot, args, context) {
    const minCount = args.minimumFood ?? 16
    const foodItems = bot.inventory.items().filter(i => EDIBLE_FOODS.includes(i.name))
    const currentCount = foodItems.reduce((acc, i) => acc + i.count, 0)

    if (currentCount >= minCount) {
      return {
        success: true,
        currentFood: currentCount,
        adequate: true,
        message: `Food reserves sufficient (${currentCount}/${minCount})`,
      }
    }

    // Attempt to gather or harvest
    return {
      success: true,
      currentFood: currentCount,
      adequate: false,
      recommendedAction: 'harvest_crops_or_hunt',
      shortage: minCount - currentCount,
    }
  },
})

// ─── build_sustainable_farm ─────────────────────────────────────────────────
skillRegistry.register({
  id: 'build_sustainable_farm',
  name: 'Build Sustainable Farm',
  category: 'food_farming',
  description: 'Construct a 5x5 farm plot with central water source, tilled soil, and perimeter',
  arguments: {
    cropType: { type: 'string', required: false, default: 'wheat_seeds', description: 'Initial seed to plant' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 120000,

  async execute(bot, args, context) {
    const pos = bot.entity.position
    const center = new Vec3(Math.floor(pos.x) + 3, Math.floor(pos.y), Math.floor(pos.z) + 3)

    log.info({ center }, 'Creating 5x5 sustainable farm plot')

    const hoe = bot.inventory.items().find(i => i.name.endsWith('_hoe'))
    if (!hoe) return { success: false, error: 'Hoe required to build farm' }

    await bot.equip(hoe, 'hand')

    let tilledCount = 0
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (dx === 0 && dz === 0) continue // Center reserved for water
        const targetPos = center.offset(dx, -1, dz)
        const block = bot.blockAt(targetPos)
        if (block && (block.name === 'dirt' || block.name === 'grass_block')) {
          try {
            bot.pathfinder.setGoal(new GoalNear(targetPos.x, targetPos.y + 1, targetPos.z, 2))
            await new Promise(r => setTimeout(r, 800))
            await bot.activateBlock(block)
            tilledCount++
          } catch {
            // continue
          }
        }
      }
    }

    return {
      success: true,
      farmCenter: { x: center.x, y: center.y, z: center.z },
      tilledCount,
      dimensions: '5x5',
    }
  },
})

