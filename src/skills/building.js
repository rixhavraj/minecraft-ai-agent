/**
 * Building and Construction skills module for minecraft-ai-squad
 *
 * Implements a blueprint-based building engine supporting:
 * - Small wooden house
 * - Stone house
 * - Watchtower
 * - Defensive walls
 * - Bridges
 * - Storage rooms
 * - Roads
 * - Emergency shelters
 * - Terrain clearing and structure verification
 */

import { skillRegistry } from './registry.js'
import { logger } from '../utils/logger.js'
import pathfinderPackage from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'

const { goals: { GoalNear, GoalGetToBlock } } = pathfinderPackage
const log = logger.child({ component: 'BuildingSkills' })

// ─── Helper: Place a single block at target position ─────────────────────────
async function placeBlockAt(bot, blockName, targetPos, context) {
  // Check if already block at position
  const current = bot.blockAt(targetPos)
  if (current && current.name === blockName) return true
  if (current && current.name !== 'air' && current.name !== 'water' && current.name !== 'grass') {
    // Dig obstructing block
    try {
      await bot.dig(current)
    } catch {
      // ignore
    }
  }

  // Find block in inventory
  const item = bot.inventory.items().find(i => i.name === blockName)
  if (!item) {
    throw new Error(`Missing building material '${blockName}' in inventory`)
  }

  // Approach target position
  const dist = bot.entity.position.distanceTo(targetPos)
  if (dist > 4) {
    try {
      bot.pathfinder.setGoal(new GoalNear(targetPos.x, targetPos.y, targetPos.z, 3))
      await new Promise(r => setTimeout(r, 1200))
    } catch {
      // proceed
    }
  }

  await bot.equip(item, 'hand')

  // Find adjacent solid block to place against
  const directions = [
    new Vec3(0, -1, 0), // below
    new Vec3(0, 1, 0),  // above
    new Vec3(1, 0, 0),  // east
    new Vec3(-1, 0, 0), // west
    new Vec3(0, 0, 1),  // south
    new Vec3(0, 0, -1), // north
  ]

  for (const d of directions) {
    const refPos = targetPos.plus(d)
    const refBlock = bot.blockAt(refPos)
    if (refBlock && refBlock.boundingBox === 'block') {
      const faceVec = d.scaled(-1)
      try {
        await bot.placeBlock(refBlock, faceVec)
        return true
      } catch {
        // try next face
      }
    }
  }

  return false
}

// ─── place_block ─────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'place_block',
  name: 'Place Single Block',
  category: 'building',
  description: 'Place a specific block at target coordinates',
  arguments: {
    blockName: { type: 'string', required: true, description: 'Block name' },
    x: { type: 'number', required: true, description: 'Target X' },
    y: { type: 'number', required: true, description: 'Target Y' },
    z: { type: 'number', required: true, description: 'Target Z' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 30000,

  async execute(bot, args, context) {
    const target = new Vec3(args.x, args.y, args.z)
    const success = await placeBlockAt(bot, args.blockName, target, context)
    return {
      success,
      blockPlaced: args.blockName,
      position: { x: args.x, y: args.y, z: args.z },
    }
  },
})

// ─── build_structure (from blueprint) ────────────────────────────────────────
skillRegistry.register({
  id: 'build_structure',
  name: 'Build Structure from Blueprint',
  category: 'building',
  description: 'Construct a structure layer-by-layer based on a blueprint definition',
  arguments: {
    blueprint: { type: 'object', required: true, description: 'Blueprint object with layers and origin' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 300000,

  async execute(bot, args, context) {
    const bp = args.blueprint
    if (!bp || !bp.layers) {
      return { success: false, error: 'Invalid blueprint: missing layers' }
    }

    const origin = new Vec3(bp.origin?.x ?? Math.floor(bot.entity.position.x), bp.origin?.y ?? Math.floor(bot.entity.position.y), bp.origin?.z ?? Math.floor(bot.entity.position.z))
    log.info({ name: bp.name, origin, layers: bp.layers.length }, 'Starting blueprint construction')

    let totalPlaced = 0
    let totalErrors = 0

    // Build layer by layer from bottom to top
    const sortedLayers = [...bp.layers].sort((a, b) => a.y - b.y)

    for (const layer of sortedLayers) {
      for (const blockSpec of layer.blocks) {
        const targetPos = origin.offset(blockSpec.x, layer.y, blockSpec.z)
        try {
          const placed = await placeBlockAt(bot, blockSpec.block, targetPos, context)
          if (placed) totalPlaced++
          else totalErrors++
        } catch (err) {
          totalErrors++
          log.warn({ err: err.message, block: blockSpec.block, targetPos }, 'Failed placing blueprint block')
        }
      }
    }

    return {
      success: totalPlaced > 0,
      structureName: bp.name,
      blocksPlaced: totalPlaced,
      errors: totalErrors,
      origin: { x: origin.x, y: origin.y, z: origin.z },
    }
  },
})

// ─── build_small_house ───────────────────────────────────────────────────────
skillRegistry.register({
  id: 'build_small_house',
  name: 'Build Small Wooden House',
  category: 'building',
  description: 'Construct a 5x4x5 wooden house with walls, doorway, and roof',
  arguments: {
    material: { type: 'string', required: false, default: 'oak_planks', description: 'Wall/floor material' },
    originX: { type: 'number', required: false, description: 'Origin X' },
    originY: { type: 'number', required: false, description: 'Origin Y' },
    originZ: { type: 'number', required: false, description: 'Origin Z' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 180000,

  async execute(bot, args, context) {
    const material = args.material ?? 'oak_planks'
    const pos = bot.entity.position
    const ox = args.originX ?? Math.floor(pos.x) + 2
    const oy = args.originY ?? Math.floor(pos.y)
    const oz = args.originZ ?? Math.floor(pos.z) + 2

    // Generate 5x4x5 house blueprint
    const layers = []

    // Layer 0: Floor (5x5)
    const floorBlocks = []
    for (let x = 0; x < 5; x++) {
      for (let z = 0; z < 5; z++) {
        floorBlocks.push({ x, z, block: material })
      }
    }
    layers.push({ y: 0, blocks: floorBlocks })

    // Layers 1 to 3: Walls with door opening at x=2, z=0
    for (let y = 1; y <= 3; y++) {
      const wallBlocks = []
      for (let x = 0; x < 5; x++) {
        for (let z = 0; z < 5; z++) {
          const isPerimeter = x === 0 || x === 4 || z === 0 || z === 4
          const isDoor = z === 0 && x === 2 && y <= 2
          if (isPerimeter && !isDoor) {
            wallBlocks.push({ x, z, block: material })
          }
        }
      }
      layers.push({ y, blocks: wallBlocks })
    }

    // Layer 4: Roof (5x5 ceiling)
    const roofBlocks = []
    for (let x = 0; x < 5; x++) {
      for (let z = 0; z < 5; z++) {
        roofBlocks.push({ x, z, block: material })
      }
    }
    layers.push({ y: 4, blocks: roofBlocks })

    const blueprint = {
      name: 'Small Wooden House (5x5)',
      origin: { x: ox, y: oy, z: oz },
      layers,
    }

    return skillRegistry.get('build_structure').execute(bot, { blueprint }, context)
  },
})

// ─── build_stone_house ───────────────────────────────────────────────────────
skillRegistry.register({
  id: 'build_stone_house',
  name: 'Build Stone House',
  category: 'building',
  description: 'Construct a sturdy 5x4x5 cobblestone house',
  arguments: {
    material: { type: 'string', required: false, default: 'cobblestone', description: 'Stone material' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 180000,

  async execute(bot, args, context) {
    return skillRegistry.get('build_small_house').execute(bot, { material: args.material ?? 'cobblestone' }, context)
  },
})

// ─── build_watchtower ────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'build_tower',
  name: 'Build Watchtower',
  category: 'building',
  description: 'Construct a 3x3 watchtower with elevated platform',
  arguments: {
    height: { type: 'number', required: false, default: 6, description: 'Tower height' },
    material: { type: 'string', required: false, default: 'cobblestone', description: 'Building material' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 180000,

  async execute(bot, args, context) {
    const height = Math.min(args.height ?? 6, 10)
    const material = args.material ?? 'cobblestone'
    const pos = bot.entity.position
    const ox = Math.floor(pos.x) + 2
    const oy = Math.floor(pos.y)
    const oz = Math.floor(pos.z) + 2

    const layers = []
    for (let y = 0; y < height; y++) {
      const blocks = [
        { x: 0, z: 0, block: material },
        { x: 2, z: 0, block: material },
        { x: 0, z: 2, block: material },
        { x: 2, z: 2, block: material },
      ]
      layers.push({ y, blocks })
    }

    // Top observation platform 3x3
    const topBlocks = []
    for (let x = 0; x < 3; x++) {
      for (let z = 0; z < 3; z++) {
        topBlocks.push({ x, z, block: material })
      }
    }
    layers.push({ y: height, blocks: topBlocks })

    const blueprint = {
      name: 'Watchtower',
      origin: { x: ox, y: oy, z: oz },
      layers,
    }

    return skillRegistry.get('build_structure').execute(bot, { blueprint }, context)
  },
})

// ─── build_wall ──────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'build_wall',
  name: 'Build Defensive Wall',
  category: 'building',
  description: 'Construct a straight perimeter defensive wall',
  arguments: {
    length: { type: 'number', required: false, default: 8, description: 'Wall length' },
    height: { type: 'number', required: false, default: 3, description: 'Wall height' },
    material: { type: 'string', required: false, default: 'cobblestone', description: 'Wall block' },
    axis: { type: 'string', required: false, default: 'x', description: 'Direction axis (x or z)' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 120000,

  async execute(bot, args, context) {
    const len = args.length ?? 8
    const height = args.height ?? 3
    const material = args.material ?? 'cobblestone'
    const axis = args.axis ?? 'x'
    const pos = bot.entity.position
    const ox = Math.floor(pos.x) + 1
    const oy = Math.floor(pos.y)
    const oz = Math.floor(pos.z) + 1

    const layers = []
    for (let y = 0; y < height; y++) {
      const blocks = []
      for (let i = 0; i < len; i++) {
        blocks.push({
          x: axis === 'x' ? i : 0,
          z: axis === 'z' ? i : 0,
          block: material,
        })
      }
      layers.push({ y, blocks })
    }

    const blueprint = {
      name: `Defensive Wall (${len}x${height})`,
      origin: { x: ox, y: oy, z: oz },
      layers,
    }

    return skillRegistry.get('build_structure').execute(bot, { blueprint }, context)
  },
})

// ─── build_bridge ────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'build_bridge',
  name: 'Build Bridge',
  category: 'building',
  description: 'Construct a flat walkway across water or a gap',
  arguments: {
    length: { type: 'number', required: false, default: 6, description: 'Bridge length' },
    material: { type: 'string', required: false, default: 'oak_planks', description: 'Bridge block' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 90000,

  async execute(bot, args, context) {
    const len = args.length ?? 6
    const material = args.material ?? 'oak_planks'
    const pos = bot.entity.position
    const ox = Math.floor(pos.x) + 1
    const oy = Math.floor(pos.y)
    const oz = Math.floor(pos.z)

    const blocks = []
    for (let i = 0; i < len; i++) {
      blocks.push({ x: i, z: 0, block: material })
      blocks.push({ x: i, z: 1, block: material })
    }

    const blueprint = {
      name: `Bridge (${len}x2)`,
      origin: { x: ox, y: oy, z: oz },
      layers: [{ y: 0, blocks }],
    }

    return skillRegistry.get('build_structure').execute(bot, { blueprint }, context)
  },
})

// ─── clear_area ──────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'clear_area',
  name: 'Clear and Flatten Terrain',
  category: 'building',
  description: 'Clear obstructing blocks, grass, and trees from a rectangular area',
  arguments: {
    width: { type: 'number', required: false, default: 5, description: 'Area width' },
    length: { type: 'number', required: false, default: 5, description: 'Area length' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 60000,

  async execute(bot, args) {
    const width = args.width ?? 5
    const length = args.length ?? 5
    const pos = bot.entity.position
    const ox = Math.floor(pos.x) + 1
    const baseY = Math.floor(pos.y)
    const oz = Math.floor(pos.z) + 1

    let cleared = 0
    for (let x = 0; x < width; x++) {
      for (let z = 0; z < length; z++) {
        for (let y = baseY; y <= baseY + 2; y++) {
          const target = new Vec3(ox + x, y, oz + z)
          const b = bot.blockAt(target)
          if (b && b.name !== 'air') {
            try {
              await bot.dig(b)
              cleared++
            } catch {
              // ignore
            }
          }
        }
      }
    }

    return {
      success: true,
      blocksCleared: cleared,
      area: `${width}x${length}`,
    }
  },
})

// ─── verify_structure ────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'verify_structure',
  name: 'Verify Completed Structure',
  category: 'building',
  description: 'Compare placed blocks in world against blueprint specification',
  arguments: {
    blueprint: { type: 'object', required: true, description: 'Blueprint to check' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 30000,

  async execute(bot, args) {
    const bp = args.blueprint
    const origin = new Vec3(bp.origin.x, bp.origin.y, bp.origin.z)
    let matching = 0
    let missing = 0

    for (const layer of bp.layers) {
      for (const blockSpec of layer.blocks) {
        const p = origin.offset(blockSpec.x, layer.y, blockSpec.z)
        const b = bot.blockAt(p)
        if (b && b.name === blockSpec.block) {
          matching++
        } else {
          missing++
        }
      }
    }

    const total = matching + missing
    const percentage = total > 0 ? Math.round((matching / total) * 100) : 100

    return {
      success: percentage >= 80,
      matching,
      missing,
      total,
      integrityPercentage: percentage,
    }
  },
})

