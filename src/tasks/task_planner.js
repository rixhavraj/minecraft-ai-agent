/**
 * Task Planner and Natural-Language Command Decomposer
 *
 * Translates human natural language commands into structured, sequential,
 * and dependency-aware Minecraft task plans.
 */

import { memoryStore } from '../database/memory_store.js'
import { agentRegistry } from '../agents/agent_registry.js'
import { skillRegistry } from '../skills/registry.js'
import { logger } from '../utils/logger.js'

const log = logger.child({ component: 'TaskPlanner' })

export class TaskPlanner {
  constructor() {
    this.agentRegistry = agentRegistry
  }

  /**
   * Plan a high-level command into a series of executable subtasks
   * @param {string} commandText
   * @returns {{ planId: string, instruction: string, tasks: Array<object>, estimatedDuration: number }}
   */
  plan(commandText, issuerName = null) {
    const text = commandText.trim().toLowerCase()
    log.info({ instruction: commandText, issuerName }, 'Planning command')

    // Check relevant previous lessons learned
    const pastLessons = memoryStore.findRelevantLessons(commandText)
    if (pastLessons.length > 0) {
      log.info({ lessonsCount: pastLessons.length }, 'Retrieved historical lessons for task planning')
    }

    const subtasks = []

    // Clean-world acceptance sequence. Each step is delegated to the existing
    // authoritative skill executor and must pass its own game-state check.
    if (/(clean|empty|fresh).*(world|inventory)|survival bootstrap|bootstrap survival|acceptance test|establish a safe base|survival essentials/.test(text)) {
      subtasks.push(
        { id: 'step_acceptance_wood', description: 'Gather starter wood', skillId: 'collect_wood', agent: 'Explorer', args: { woodType: 'oak', quantity: 4 } },
        { id: 'step_acceptance_planks', description: 'Craft starter planks', skillId: 'craft_planks', agent: 'Crafter', args: { count: 2 } },
        { id: 'step_acceptance_table', description: 'Craft a crafting table', skillId: 'craft_crafting_table', agent: 'Crafter', args: {} },
        { id: 'step_acceptance_place_table', description: 'Place the crafting table', skillId: 'place_crafting_table', agent: 'Crafter', args: {} },
        { id: 'step_acceptance_wooden_pickaxe', description: 'Craft a wooden pickaxe', skillId: 'craft_wooden_tools', agent: 'Crafter', args: { tool: 'wooden_pickaxe' } },
        { id: 'step_acceptance_stone', description: 'Collect cobblestone', skillId: 'collect_stone', agent: 'Miner', args: { quantity: 8 } },
        { id: 'step_acceptance_stone_pickaxe', description: 'Craft a stone pickaxe', skillId: 'craft_stone_tools', agent: 'Crafter', args: { tool: 'stone_pickaxe' } },
        { id: 'step_acceptance_food', description: 'Find food', skillId: 'find_food', agent: 'Survival', args: { maxDistance: 64 } },
        { id: 'step_acceptance_eat', description: 'Eat food if hunger requires it', skillId: 'eat_food', agent: 'Survival', args: {} },
        { id: 'step_acceptance_iron', description: 'Mine iron ore', skillId: 'collect_ore', agent: 'Miner', args: { ore: 'iron', quantity: 3 } },
        { id: 'step_acceptance_smelt', description: 'Smelt iron', skillId: 'smelt_ores', agent: 'Crafter', args: { ore: 'raw_iron', quantity: 3 } },
        { id: 'step_acceptance_iron_pickaxe', description: 'Craft an iron pickaxe', skillId: 'craft_item', agent: 'Crafter', args: { itemName: 'iron_pickaxe', quantity: 1 } },
        { id: 'step_acceptance_shelter', description: 'Build a basic shelter', skillId: 'build_small_house', agent: 'Builder', args: { material: 'oak_planks' } },
        { id: 'step_acceptance_base', description: 'Save shelter as base', skillId: 'save_base', agent: 'Commander', args: { name: 'acceptance_base' } },
      )
    }

    // Emergency survival must invoke the real movement skill. Without this
    // route, "escape danger" falls through to harmless perception steps.
    else if (text.includes('escape danger') || text.includes('flee') || text.includes('run away')) {
      subtasks.push({ id: 'step_escape_danger', description: 'Escape nearby threats to a safer position', skillId: 'escape_danger', agent: 'Survival', args: { fleeDistance: 24 } })
    }

    // Bed/sleep is an explicit survival objective, not a generic scan. First
    // search for a village bed, then invoke the real nighttime preparation
    // skill so the bot only claims sleep after the world verifies it.
    else if (text.includes('bed') || text.includes('sleep')) {
      subtasks.push({
        id: 'step_find_and_sleep',
        description: 'Immediately search nearby blocks for a bed, run to it, and sleep',
        skillId: 'find_and_sleep',
        agent: 'Survival',
        args: { radius: 256 },
      })
    }

    // A Minecraft spawn point is established by successfully sleeping in a
    // bed. Keep this as one explicit survival action instead of treating it
    // as an unknown command.
    else if (text.includes('spawn point') || text.includes('set spawn')) {
      subtasks.push({
        id: 'step_set_spawn_point',
        description: 'Sleep in a bed to set and verify the spawn point',
        skillId: 'find_and_sleep',
        agent: 'Survival',
        args: {},
      })
    }

    // 1. "collect X logs and build a house" or "build a house"
    else if (text.includes('build') && (text.includes('house') || text.includes('base') || text.includes('shelter'))) {
      const isStone = text.includes('stone')
      const woodQtyMatch = text.match(/collect\s+(\d+)\s+([a-z_]+)\s+logs?/i)
      const woodQty = woodQtyMatch ? parseInt(woodQtyMatch[1], 10) : 32
      const woodType = woodQtyMatch ? woodQtyMatch[2] : 'oak'

      if (text.includes('collect') || !isStone) {
        subtasks.push({
          id: 'step_find_trees',
          description: `Find suitable ${woodType} trees`,
          skillId: 'find_forest',
          agent: 'Explorer',
          args: { woodType: `${woodType}_log`, maxDistance: 128 },
        })
        subtasks.push({
          id: 'step_check_inventory_wood',
          description: 'Check current inventory for wood resources',
          skillId: 'count_item',
          agent: 'Memory',
          args: { itemName: `${woodType}_log` },
        })
        subtasks.push({
          id: 'step_collect_logs',
          description: `Collect ${woodQty} ${woodType} logs`,
          skillId: 'collect_wood',
          agent: 'Miner',
          args: { woodType, quantity: woodQty },
        })
        subtasks.push({
          id: 'step_craft_planks',
          description: 'Craft logs into wooden planks',
          skillId: 'craft_planks',
          agent: 'Crafter',
          args: { count: Math.ceil(woodQty / 2) },
        })
      }

      subtasks.push({
        id: 'step_find_build_site',
        description: 'Locate suitable flat building area',
        skillId: 'find_building_location',
        agent: 'Explorer',
        args: { width: 7, length: 7, maxDistance: 48 },
      })
      subtasks.push({
        id: 'step_clear_site',
        description: 'Clear obstacles and vegetation from build site',
        skillId: 'clear_area',
        agent: 'Builder',
        args: { width: 6, length: 6 },
      })
      subtasks.push({
        id: 'step_construct_house',
        description: isStone ? 'Construct stone house' : 'Construct small wooden house',
        skillId: isStone ? 'build_stone_house' : 'build_small_house',
        agent: 'Builder',
        args: { material: isStone ? 'cobblestone' : 'oak_planks' },
      })
      subtasks.push({
        id: 'step_save_base_coords',
        description: 'Record constructed house coordinates as base',
        skillId: 'save_base',
        agent: 'Commander',
        args: { name: 'home_base' },
      })
    }

    // 2. Resource gathering: "collect 64 oak logs", "collect stone", "mine diamonds"
    else if (text.startsWith('collect') || text.startsWith('mine') || text.startsWith('gather') || text.startsWith('find iron') || text.startsWith('find coal')) {
      const qtyMatch = text.match(/(\d+)/)
      const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 16

      if (text.includes('log') || text.includes('wood')) {
        let woodType = 'oak'
        if (text.includes('birch')) woodType = 'birch'
        else if (text.includes('spruce')) woodType = 'spruce'
        else if (text.includes('jungle')) woodType = 'jungle'
        else if (text.includes('acacia')) woodType = 'acacia'
        else if (text.includes('dark oak')) woodType = 'dark_oak'

        subtasks.push({
          id: 'step_find_forest',
          description: `Find ${woodType} forest`,
          skillId: 'find_forest',
          agent: 'Explorer',
          args: { woodType: `${woodType}_log` },
        })
        subtasks.push({
          id: 'step_gather_wood',
          description: `Collect ${qty} ${woodType} logs`,
          skillId: 'collect_wood',
          agent: 'Miner',
          args: { woodType, quantity: qty },
        })
      } else if (text.includes('stone') || text.includes('cobble')) {
        subtasks.push({
          id: 'step_gather_stone',
          description: `Mine ${qty} cobblestone`,
          skillId: 'collect_stone',
          agent: 'Miner',
          args: { quantity: qty },
        })
      } else {
        // Ore extraction
        let oreType = 'iron'
        if (text.includes('diamond')) oreType = 'diamond'
        else if (text.includes('coal')) oreType = 'coal'
        else if (text.includes('copper')) oreType = 'copper'
        else if (text.includes('gold')) oreType = 'gold'
        else if (text.includes('redstone')) oreType = 'redstone'
        else if (text.includes('lapis')) oreType = 'lapis'

        // Iron and higher ores require a pickaxe. Ensure a basic stone pickaxe
        // can be made before the equip/mine steps run in a fresh world.
        if (['iron', 'copper', 'gold', 'redstone', 'lapis', 'diamond'].includes(oreType)) {
          subtasks.push({
            id: 'step_gather_pickaxe_wood',
            description: 'Gather wood for the first pickaxe',
            skillId: 'collect_wood',
            agent: 'Miner',
            args: { woodType: 'oak', quantity: 4 },
          })
          subtasks.push({
            id: 'step_craft_pickaxe_planks',
            description: 'Craft planks for the first pickaxe',
            skillId: 'craft_planks',
            agent: 'Crafter',
            args: { count: 2 },
          })
          subtasks.push({
            id: 'step_craft_table',
            description: 'Craft a crafting table for tool preparation',
            skillId: 'craft_crafting_table',
            agent: 'Crafter',
            args: {},
          })
          subtasks.push({
            id: 'step_place_table',
            description: 'Place the crafting table for tool preparation',
            skillId: 'place_crafting_table',
            agent: 'Crafter',
            args: {},
          })
          subtasks.push({
            id: 'step_craft_wooden_pickaxe',
            description: 'Craft a wooden pickaxe to mine stone',
            skillId: 'craft_wooden_tools',
            agent: 'Crafter',
            args: { tool: 'wooden_pickaxe' },
          })
          subtasks.push({
            id: 'step_gather_pickaxe_stone',
            description: 'Gather cobblestone for a mining pickaxe',
            skillId: 'collect_stone',
            agent: 'Miner',
            args: { quantity: 3 },
          })
          subtasks.push({
            id: 'step_craft_pickaxe',
            description: 'Craft a stone pickaxe before mining ore',
            skillId: 'craft_stone_tools',
            agent: 'Crafter',
            args: { tool: 'stone_pickaxe' },
          })
        }

        subtasks.push({
          id: 'step_equip_tool',
          description: `Equip best tool for mining ${oreType}`,
          skillId: 'equip_best_tool',
          agent: 'Miner',
          args: { blockName: `${oreType}_ore` },
        })
        subtasks.push({
          id: 'step_mine_ore',
          description: `Mine ${qty} ${oreType}`,
          skillId: 'collect_ore',
          agent: 'Miner',
          args: { ore: oreType, quantity: qty },
        })
      }
    }

    // 3. Farming / Food: "find food", "create a farm", "harvest crops", "hunt animals"
    else if (text.includes('food') || text.includes('farm') || text.includes('wheat') || text.includes('hunt') || text.includes('eat')) {
      if (text.includes('create a farm') || text.includes('build a farm') || text.includes('make a farm')) {
        subtasks.push({
          id: 'step_find_water',
          description: 'Locate water source for farming',
          skillId: 'find_river',
          agent: 'Explorer',
          args: { maxDistance: 48 },
        })
        subtasks.push({
          id: 'step_build_farm',
          description: 'Construct sustainable 5x5 farm plot',
          skillId: 'build_sustainable_farm',
          agent: 'Survival',
          args: { cropType: 'wheat_seeds' },
        })
      } else if (text.includes('farm') || text.includes('harvest') || text.includes('potato') || text.includes('wheat') || text.includes('carrot') || text.includes('beetroot')) {
        const cropType = text.includes('potato') ? 'potatoes' : text.includes('carrot') ? 'carrots' : text.includes('beetroot') ? 'beetroots' : 'wheat'
        const seedName = cropType === 'potatoes' ? 'potato' : cropType === 'carrots' ? 'carrot' : cropType === 'beetroots' ? 'beetroot' : 'wheat_seeds'
        subtasks.push({ id: 'step_harvest_crop', description: `Harvest mature ${cropType} and replant them`, skillId: 'harvest_crops', agent: 'Farmer', args: { cropType, maxCount: 16, replant: true } })
        subtasks.push({ id: 'step_plant_crop', description: `Plant available ${cropType} for the next harvest`, skillId: 'plant_crops', agent: 'Farmer', args: { cropType: seedName, maxCount: 16 } })
        subtasks.push({ id: 'step_eat_crop_food', description: 'Eat harvested food if hunger is low', skillId: 'eat_food', agent: 'Survival', args: {} })
      } else if (text.includes('hunt')) {
        subtasks.push({
          id: 'step_hunt_animals',
          description: 'Hunt passive animals for food',
          skillId: 'hunt_animal',
          agent: 'Survival',
          args: { quantity: 2 },
        })
      } else {
        subtasks.push({
          id: 'step_search_food',
          description: 'Scan inventory and surroundings for food',
          skillId: 'find_food',
          agent: 'Survival',
          args: { maxDistance: 32 },
        })
        subtasks.push({
          id: 'step_harvest_or_consume',
          description: 'Consume available food or harvest mature crops',
          skillId: 'eat_food',
          agent: 'Survival',
          args: {},
        })
      }
    }

    // 4. Crafting: "craft iron pickaxe", "craft crafting table", "build a axe", "make tools"
    else if (text.startsWith('craft') || text.startsWith('make') || (text.startsWith('build') && /\b(axe|pickaxe|sword|shovel|hoe|tools?|table|chest|furnace|bed|shield|torch)\b/i.test(text))) {
      const itemName = text.replace(/^(craft|make|build|get)\s+(an?\s+)?/i, '').replace(/\s+/g, '_').trim()

      // A crafting command must include its early-game material dependencies.
      // Mineflayer correctly rejects recipes when these are absent; the planner
      // should gather them before invoking craft_item instead of failing once.
      if (itemName.includes('axe') || itemName.includes('pickaxe') || itemName.includes('sword') || itemName.includes('shovel') || itemName.includes('hoe')) {
        subtasks.push({
          id: 'step_gather_crafting_wood',
          description: 'Gather wood needed for crafting materials',
          skillId: 'collect_wood',
          agent: 'Miner',
          args: { woodType: 'oak', quantity: 4 },
        })
        subtasks.push({
          id: 'step_craft_crafting_planks',
          description: 'Convert gathered logs into planks',
          skillId: 'craft_planks',
          agent: 'Crafter',
          args: { count: 2 },
        })
        subtasks.push({
          id: 'step_craft_tool_table',
          description: 'Craft a crafting table for equipment',
          skillId: 'craft_crafting_table',
          agent: 'Crafter',
          args: {},
        })
        subtasks.push({
          id: 'step_place_tool_table',
          description: 'Place the crafting table for equipment',
          skillId: 'place_crafting_table',
          agent: 'Crafter',
          args: {},
        })
      }
      subtasks.push({
        id: 'step_craft_equipment',
        description: `Craft ${itemName}`,
        skillId: 'craft_item',
        agent: 'Crafter',
        args: { itemName, quantity: 1 },
      })
    }

    // 5. Explicit coordinate navigation: "go to 199 64 162"
    else if (/(?:go|goto|move|navigate)\s+to\s+[-+]?\d+(?:\.\d+)?\s+[-+]?\d+(?:\.\d+)?\s+[-+]?\d+/.test(text)) {
      const match = text.match(/(?:go|goto|move|navigate)\s+to\s+([-+]?\d+(?:\.\d+)?)\s+([-+]?\d+(?:\.\d+)?)\s+([-+]?\d+(?:\.\d+)?)/)
      subtasks.push({
        id: 'step_goto_position',
        description: `Navigate to coordinates ${match[1]} ${match[2]} ${match[3]}`,
        skillId: 'goto_position',
        agent: 'Explorer',
        args: { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) },
      })
    }
    // 6. Exploration & Navigation: "explore the world", "find a village", "return to base", "follow me"
    else if (text.includes('village')) {
      subtasks.push({
        id: 'step_find_village',
        description: 'Explore and search for village',
        skillId: 'find_village',
        agent: 'Explorer',
        args: { maxDistance: 256 },
      })
    } else if (text.includes('explore')) {
      subtasks.push({
        id: 'step_explore_area',
        description: 'Explore surroundings within 64 blocks',
        skillId: 'explore_area',
        agent: 'Explorer',
        args: { radius: 64, duration: 30000 },
      })
    } else if (text.includes('return to base') || text.includes('go home')) {
      subtasks.push({
        id: 'step_return_base',
        description: 'Return to saved base coordinates',
        skillId: 'return_to_saved_base',
        agent: 'Explorer',
        args: {},
      })
    } else if (text.includes('follow') || text.includes('come')) {
      const match = text.match(/(?:follow|come(?:\s+to)?)\s+([a-zA-Z0-9_]+)/i)
      let targetPlayer = 'me'
      if (match && match[1] && match[1].toLowerCase() !== 'me' && match[1].toLowerCase() !== 'here') {
        targetPlayer = match[1]
      } else if (issuerName && issuerName !== 'Owner') {
        targetPlayer = issuerName
      } else if (process.env.MINECRAFT_PLAYER_NAME) {
        targetPlayer = process.env.MINECRAFT_PLAYER_NAME
      }
      const needsWaterTransport = text.includes('water') || text.includes('boat') || text.includes('safest route')
      if (needsWaterTransport) {
        subtasks.push(
          { id: 'step_transport_wood', description: 'Collect wood for a boat', skillId: 'collect_wood', agent: 'Miner', args: { woodType: 'oak', quantity: 5 } },
          { id: 'step_transport_planks', description: 'Craft planks for a boat', skillId: 'craft_planks', agent: 'Crafter', args: { count: 5 } },
          { id: 'step_craft_boat', description: 'Craft an oak boat for crossing water', skillId: 'craft_item', agent: 'Crafter', args: { itemName: 'oak_boat', quantity: 1 } },
        )
      }
      subtasks.push({
        id: 'step_follow_player',
        description: `Follow player ${targetPlayer}, using the prepared boat when water blocks the route`,
        skillId: 'follow_player',
        agent: 'Commander',
        args: { player: targetPlayer, distance: 2 },
      })
    } else if (text.includes('stop') || text.includes('halt') || text.includes('wait')) {
      subtasks.push({
        id: 'step_stop_movement',
        description: 'Stop all bot movement immediately',
        skillId: 'stop_movement',
        agent: 'Commander',
        args: {},
      })
    }

    // 6. Combat / Defense: "protect the base", "prepare for nighttime", "defend"
    else if (text.includes('protect') || text.includes('defend') || text.includes('combat') || text.includes('night')) {
      subtasks.push({
        id: 'step_equip_combat',
        description: 'Equip best weapon and armor set',
        skillId: 'equip_best_weapon',
        agent: 'Survival',
        args: {},
      })
      subtasks.push({
        id: 'step_check_threats',
        description: 'Detect nearby hostile mobs',
        skillId: 'detect_hostile_mobs',
        agent: 'Survival',
        args: { radius: 20 },
      })
      subtasks.push({
        id: 'step_defend_base',
        description: 'Guard base perimeter against threats',
        skillId: 'defend_base',
        agent: 'Survival',
        args: { radius: 16, durationMs: 30000 },
      })
    }

    // Default fallback: choose one bounded objective. Do not append inventory
    // inspection or another discovery objective; that creates competing focus
    // and makes a single user request look like multiple tasks.
    if (subtasks.length === 0) {
      subtasks.push({
        id: 'step_scan_nearby',
        description: 'Scan the nearby environment and record useful discoveries',
        skillId: 'scan_nearby',
        agent: 'Explorer',
        args: { radius: 32 },
      })
    }

    return {
      planId: `plan_${Date.now()}`,
      instruction: commandText,
      tasks: subtasks,
      totalSteps: subtasks.length,
      estimatedDuration: subtasks.length * 30000,
    }
  }
}

export const taskPlanner = new TaskPlanner()

