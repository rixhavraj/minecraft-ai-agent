/**
 * Exploration skills module for minecraft-ai-squad
 *
 * Implements scanning, terrain identification, finding biomes/structures,
 * finding building locations, recording coordinates, and mapping.
 */

import { skillRegistry } from './registry.js'
import { logger } from '../utils/logger.js'
import pathfinderPackage from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'

const { goals: { GoalBlock, GoalXZ, GoalNear } } = pathfinderPackage
const log = logger.child({ component: 'ExplorationSkills' })

// Memory store for discovered and saved locations
const savedLocations = new Map()
const exploredChunks = new Set()

/**
 * Helper to record explored chunk for current position
 */
function recordExploredPosition(pos) {
  if (!pos) return
  const chunkX = Math.floor(pos.x / 16)
  const chunkZ = Math.floor(pos.z / 16)
  exploredChunks.add(`${chunkX},${chunkZ}`)
}

// ─── scan_nearby ─────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'scan_nearby',
  name: 'Scan Nearby Blocks',
  category: 'exploration',
  description: 'Scan surroundings for interesting blocks (ores, wood, water, structures, flora)',
  arguments: {
    radius: { type: 'number', required: false, default: 32, description: 'Scan radius' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 30000,

  async execute(bot, args, context) {
    const radius = Math.min(args.radius ?? 32, 64)
    const pos = bot.entity.position
    recordExploredPosition(pos)

    const categories = {
      ores: [],
      wood: [],
      water: [],
      crops: [],
      containers: [],
      hazards: [],
    }

    const checkList = [
      { cat: 'ores', names: ['coal_ore', 'deepslate_coal_ore', 'iron_ore', 'deepslate_iron_ore', 'copper_ore', 'gold_ore', 'diamond_ore', 'deepslate_diamond_ore', 'redstone_ore', 'lapis_ore'] },
      { cat: 'wood', names: ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'] },
      { cat: 'water', names: ['water'] },
      { cat: 'crops', names: ['wheat', 'carrots', 'potatoes', 'beetroots', 'sweet_berry_bush'] },
      { cat: 'containers', names: ['chest', 'trapped_chest', 'barrel', 'furnace', 'blast_furnace', 'smoker'] },
      { cat: 'hazards', names: ['lava', 'fire', 'sweet_berry_bush', 'cactus'] },
    ]

    for (const group of checkList) {
      for (const name of group.names) {
        const blockDef = context.mcData.blocksByName[name]
        if (!blockDef) continue
        const found = bot.findBlocks({
          matching: blockDef.id,
          maxDistance: radius,
          count: 5,
        })
        for (const p of found) {
          categories[group.cat].push({
            name,
            x: p.x,
            y: p.y,
            z: p.z,
            distance: Number(pos.distanceTo(p).toFixed(1)),
          })
        }
      }
    }

    log.info({
      ores: categories.ores.length,
      wood: categories.wood.length,
      water: categories.water.length,
      containers: categories.containers.length,
    }, 'Scan completed')

    return {
      success: true,
      center: { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) },
      radius,
      findings: categories,
    }
  },
})

// ─── identify_terrain ────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'identify_terrain',
  name: 'Identify Terrain',
  category: 'exploration',
  description: 'Analyze surrounding blocks and altitude to determine biome and terrain type',
  arguments: {},
  requires: [],
  permissions: ['*'],
  timeout: 10000,

  async execute(bot, args, context) {
    const pos = bot.entity.position
    recordExploredPosition(pos)

    const blockUnder = bot.blockAt(pos.offset(0, -1, 0))
    let biomeName = 'unknown'
    try {
      const block = bot.blockAt(pos)
      if (block?.biome?.name) {
        biomeName = block.biome.name
      }
    } catch {
      // ignore
    }

    // Survey surface blocks around bot
    const sampleBlocks = {}
    for (let dx = -10; dx <= 10; dx += 5) {
      for (let dz = -10; dz <= 10; dz += 5) {
        const b = bot.blockAt(pos.offset(dx, -1, dz))
        if (b) {
          sampleBlocks[b.name] = (sampleBlocks[b.name] || 0) + 1
        }
      }
    }

    let terrainType = 'plains'
    if (pos.y < 55) terrainType = 'underground_cave'
    else if (sampleBlocks.sand > 5) terrainType = 'desert_or_beach'
    else if (sampleBlocks.water > 5) terrainType = 'ocean_or_river'
    else if (sampleBlocks.snow_block > 3 || sampleBlocks.snow > 3) terrainType = 'snowy'
    else if (pos.y > 100) terrainType = 'mountain'

    return {
      success: true,
      position: { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) },
      biome: biomeName,
      surfaceBlock: blockUnder?.name ?? 'unknown',
      terrainType,
      samples: sampleBlocks,
    }
  },
})

// ─── find_forest ─────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'find_forest',
  name: 'Find Forest',
  category: 'exploration',
  description: 'Search for a cluster of tree logs within range',
  arguments: {
    woodType: { type: 'string', required: false, default: 'oak_log', description: 'Log type' },
    minTrees: { type: 'number', required: false, default: 3, description: 'Minimum logs' },
    maxDistance: { type: 'number', required: false, default: 128, description: 'Search distance' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 60000,

  async execute(bot, args, context) {
    const maxDist = args.maxDistance ?? 128
    const logNames = [
      'oak_log', 'birch_log', 'spruce_log', 'jungle_log',
      'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
    ]

    const targetLogs = args.woodType ? [args.woodType] : logNames
    let matchedPositions = []

    for (const name of targetLogs) {
      const def = context.mcData.blocksByName[name]
      if (!def) continue
      const found = bot.findBlocks({ matching: def.id, maxDistance: maxDist, count: 20 })
      if (found.length > 0) {
        matchedPositions = matchedPositions.concat(found.map(p => ({ name, pos: p })))
      }
    }

    if (matchedPositions.length === 0) {
      return { success: false, error: 'No forest/trees found within search distance' }
    }

    // Pick closest
    matchedPositions.sort((a, b) => bot.entity.position.distanceTo(a.pos) - bot.entity.position.distanceTo(b.pos))
    const closest = matchedPositions[0]

    return {
      success: true,
      logType: closest.name,
      location: { x: closest.pos.x, y: closest.pos.y, z: closest.pos.z },
      distance: Number(bot.entity.position.distanceTo(closest.pos).toFixed(1)),
      totalFound: matchedPositions.length,
    }
  },
})

// ─── find_cave_entrance ──────────────────────────────────────────────────────
skillRegistry.register({
  id: 'find_cave_entrance',
  name: 'Find Cave Entrance',
  category: 'exploration',
  description: 'Search for exposed dark areas or stone openings indicating a cave',
  arguments: {
    maxDistance: { type: 'number', required: false, default: 64, description: 'Search distance' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 30000,

  async execute(bot, args, context) {
    const maxDist = args.maxDistance ?? 64
    const stoneDef = context.mcData.blocksByName['stone']
    if (!stoneDef) return { success: false, error: 'Stone block definition not found' }

    // Search for stone blocks that have air above them and are lower than surface
    const stones = bot.findBlocks({ matching: stoneDef.id, maxDistance: maxDist, count: 50 })
    const caveCandidates = []

    for (const p of stones) {
      const blockAbove = bot.blockAt(p.offset(0, 1, 0))
      const blockAbove2 = bot.blockAt(p.offset(0, 2, 0))
      if (blockAbove?.name === 'air' && blockAbove2?.name === 'air') {
        const light = blockAbove.light
        if (light < 8 && p.y < bot.entity.position.y) {
          caveCandidates.push(p)
        }
      }
    }

    if (caveCandidates.length === 0) {
      return { success: false, error: 'No obvious cave entrances found nearby' }
    }

    caveCandidates.sort((a, b) => bot.entity.position.distanceTo(a) - bot.entity.position.distanceTo(b))
    const target = caveCandidates[0]

    return {
      success: true,
      location: { x: target.x, y: target.y, z: target.z },
      distance: Number(bot.entity.position.distanceTo(target).toFixed(1)),
    }
  },
})

// ─── find_village ────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'find_village',
  name: 'Find Village',
  category: 'exploration',
  description: 'Search for village markers (bell, job sites, multiple beds) nearby',
  arguments: {
    maxDistance: { type: 'number', required: false, default: 128, description: 'Search distance' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 45000,

  async execute(bot, args, context) {
    const maxDist = args.maxDistance ?? 128
    const villageMarkers = ['bell', 'lectern', 'smoker', 'blast_furnace', 'composter', 'cartography_table']

    for (const name of villageMarkers) {
      const def = context.mcData.blocksByName[name]
      if (!def) continue
      const found = bot.findBlocks({ matching: def.id, maxDistance: maxDist, count: 1 })
      if (found.length > 0) {
        const p = found[0]
        return {
          success: true,
          markerFound: name,
          location: { x: p.x, y: p.y, z: p.z },
          distance: Number(bot.entity.position.distanceTo(p).toFixed(1)),
        }
      }
    }

    return { success: false, error: 'No village structures found within range' }
  },
})

// ─── find_rivers ─────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'find_river',
  name: 'Find River or Water Body',
  category: 'exploration',
  description: 'Locate nearest large water body or river',
  arguments: {
    maxDistance: { type: 'number', required: false, default: 64, description: 'Search distance' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 20000,

  async execute(bot, args, context) {
    const maxDist = args.maxDistance ?? 64
    const waterDef = context.mcData.blocksByName['water']
    if (!waterDef) return { success: false, error: 'Water block definition not found' }

    const waters = bot.findBlocks({ matching: waterDef.id, maxDistance: maxDist, count: 10 })
    if (waters.length === 0) return { success: false, error: 'No water found nearby' }

    waters.sort((a, b) => bot.entity.position.distanceTo(a) - bot.entity.position.distanceTo(b))
    const nearest = waters[0]

    return {
      success: true,
      location: { x: nearest.x, y: nearest.y, z: nearest.z },
      distance: Number(bot.entity.position.distanceTo(nearest).toFixed(1)),
      waterCount: waters.length,
    }
  },
})

// ─── find_mountains ──────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'find_mountains',
  name: 'Find Mountains',
  category: 'exploration',
  description: 'Locate high elevation terrain nearby',
  arguments: {
    maxDistance: { type: 'number', required: false, default: 96, description: 'Search distance' },
    minY: { type: 'number', required: false, default: 90, description: 'Minimum altitude' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 20000,

  async execute(bot, args, context) {
    const maxDist = args.maxDistance ?? 96
    const minY = args.minY ?? 90
    const pos = bot.entity.position

    let highestPoint = null
    let highestY = pos.y

    for (let dx = -maxDist; dx <= maxDist; dx += 16) {
      for (let dz = -maxDist; dz <= maxDist; dz += 16) {
        const testPos = new Vec3(pos.x + dx, 0, pos.z + dz)
        // Check blocks downward from 150
        for (let y = 140; y >= minY; y -= 5) {
          const b = bot.blockAt(new Vec3(testPos.x, y, testPos.z))
          if (b && b.boundingBox === 'block' && y > highestY) {
            highestY = y
            highestPoint = new Vec3(testPos.x, y, testPos.z)
            break
          }
        }
      }
    }

    if (!highestPoint || highestY < minY) {
      return { success: false, error: `No mountain areas (Y >= ${minY}) found nearby` }
    }

    return {
      success: true,
      location: { x: highestPoint.x, y: highestPoint.y, z: highestPoint.z },
      altitude: highestY,
      distance: Number(pos.distanceTo(highestPoint).toFixed(1)),
    }
  },
})

// ─── find_building_location ──────────────────────────────────────────────────
skillRegistry.register({
  id: 'find_building_location',
  name: 'Find Building Location',
  category: 'exploration',
  description: 'Locate flat, clear ground suitable for constructing a base or structure',
  arguments: {
    width: { type: 'number', required: false, default: 7, description: 'Width required' },
    length: { type: 'number', required: false, default: 7, description: 'Length required' },
    maxDistance: { type: 'number', required: false, default: 48, description: 'Search radius' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 40000,

  async execute(bot, args, context) {
    const width = args.width ?? 7
    const length = args.length ?? 7
    const maxDist = args.maxDistance ?? 48
    const pos = bot.entity.position

    let bestSite = null
    let lowestObstacles = Infinity

    // Sample potential origins around bot
    for (let ox = -maxDist; ox <= maxDist; ox += 8) {
      for (let oz = -maxDist; oz <= maxDist; oz += 8) {
        const originX = Math.floor(pos.x + ox)
        const originZ = Math.floor(pos.z + oz)
        const baseY = Math.floor(pos.y)

        // Check flatness and absence of water/lava
        let obstacles = 0
        let flat = true

        for (let x = 0; x < width; x++) {
          for (let z = 0; z < length; z++) {
            const ground = bot.blockAt(new Vec3(originX + x, baseY - 1, originZ + z))
            const space1 = bot.blockAt(new Vec3(originX + x, baseY, originZ + z))
            const space2 = bot.blockAt(new Vec3(originX + x, baseY + 1, originZ + z))

            if (!ground || ground.name === 'water' || ground.name === 'lava' || ground.name === 'air') {
              flat = false
              break
            }
            if (space1 && space1.name !== 'air' && space1.name !== 'grass') obstacles++
            if (space2 && space2.name !== 'air') obstacles++
          }
          if (!flat) break
        }

        if (flat && obstacles < lowestObstacles) {
          lowestObstacles = obstacles
          bestSite = { x: originX, y: baseY, z: originZ }
          if (obstacles === 0) break // perfect site
        }
      }
      if (bestSite && lowestObstacles === 0) break
    }

    if (!bestSite) {
      // Fallback: bot's current location leveled
      return {
        success: true,
        location: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) },
        width,
        length,
        note: 'Using current bot location, clearing will be required',
      }
    }

    return {
      success: true,
      location: bestSite,
      width,
      length,
      obstaclesToClear: lowestObstacles,
    }
  },
})

// ─── locate_structures ───────────────────────────────────────────────────────
skillRegistry.register({
  id: 'locate_structures',
  name: 'Locate Structures',
  category: 'exploration',
  description: 'Search for manufactured blocks indicating player or world structures',
  arguments: {
    maxDistance: { type: 'number', required: false, default: 64, description: 'Search distance' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 30000,

  async execute(bot, args, context) {
    const maxDist = args.maxDistance ?? 64
    const structuralBlocks = [
      'cobblestone_wall', 'iron_bars', 'stone_bricks', 'oak_planks',
      'bookshelf', 'spruce_fence', 'oak_fence', 'nether_brick',
    ]

    const foundStructures = []
    for (const name of structuralBlocks) {
      const def = context.mcData.blocksByName[name]
      if (!def) continue
      const blocks = bot.findBlocks({ matching: def.id, maxDistance: maxDist, count: 5 })
      if (blocks.length > 0) {
        foundStructures.push({ block: name, count: blocks.length, firstPosition: blocks[0] })
      }
    }

    return {
      success: true,
      found: foundStructures.length > 0,
      structures: foundStructures,
    }
  },
})

// ─── record_coordinates ──────────────────────────────────────────────────────
skillRegistry.register({
  id: 'record_coordinates',
  name: 'Record Coordinates',
  category: 'exploration',
  description: 'Save named coordinates to in-memory discovery register',
  arguments: {
    name: { type: 'string', required: true, description: 'Location identifier' },
    x: { type: 'number', required: false, description: 'X coordinate (default: current)' },
    y: { type: 'number', required: false, description: 'Y coordinate (default: current)' },
    z: { type: 'number', required: false, description: 'Z coordinate (default: current)' },
    type: { type: 'string', required: false, default: 'poi', description: 'Location type' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 5000,

  async execute(bot, args) {
    const pos = bot.entity.position
    const x = args.x ?? Math.round(pos.x)
    const y = args.y ?? Math.round(pos.y)
    const z = args.z ?? Math.round(pos.z)

    const record = {
      name: args.name,
      x, y, z,
      type: args.type ?? 'poi',
      timestamp: Date.now(),
    }
    savedLocations.set(args.name.toLowerCase(), record)

    return {
      success: true,
      saved: record,
    }
  },
})

// ─── get_saved_location ──────────────────────────────────────────────────────
skillRegistry.register({
  id: 'get_saved_location',
  name: 'Get Saved Location',
  category: 'exploration',
  description: 'Retrieve previously recorded coordinates by name',
  arguments: {
    name: { type: 'string', required: true, description: 'Name of location' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 5000,

  async execute(bot, args) {
    const loc = savedLocations.get(args.name.toLowerCase())
    if (!loc) {
      return { success: false, error: `Location '${args.name}' not found in records` }
    }
    return {
      success: true,
      location: loc,
    }
  },
})

// ─── map_explored ────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'map_explored',
  name: 'Map Explored Locations',
  category: 'exploration',
  description: 'Retrieve summary of explored chunks and saved locations',
  arguments: {},
  requires: [],
  permissions: ['*'],
  timeout: 5000,

  async execute(bot) {
    recordExploredPosition(bot.entity?.position)
    return {
      success: true,
      exploredChunksCount: exploredChunks.size,
      savedLocationsCount: savedLocations.size,
      savedLocations: Array.from(savedLocations.values()),
    }
  },
})

export { savedLocations, exploredChunks }

