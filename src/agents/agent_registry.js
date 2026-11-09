/**
 * Ten-Agent Registry and Architecture for minecraft-ai-squad
 *
 * 1. Commander: receives commands and coordinates work
 * 2. Strategist: decomposes complex objectives into subtasks
 * 3. Explorer: discovers locations, biomes, and resources
 * 4. Miner: extracts stone, ores, and subterranean minerals
 * 5. Builder: constructs houses, walls, shelters, and blueprints
 * 6. Survival: food gathering, harvesting, animal farming and safety
 * 7. Survival: monitors health, hunger, threats, and emergency escape
 * 8. Crafter: manufactures tools, armor, tables, and smelts ores
 * 9. Researcher: memory analysis, lessons learned, and failure recovery
 * 10. Memory: persistent world, task, resource and team memory
 */

import { memoryStore } from '../database/memory_store.js'
import { logger } from '../utils/logger.js'

const log = logger.child({ component: 'AgentRegistry' })

export const AGENT_ROLES = {
  COMMANDER: {
    name: 'Commander',
    role: 'Squad Coordinator & Mission Dispatcher',
    description: 'Receives instructions from owner, delegates to specialized agents, coordinates execution',
    categories: ['*'],
  },
  STRATEGIST: {
    name: 'Strategist',
    role: 'Mission Planner & Task Decomposer',
    description: 'Breaks high-level goals into ordered sequences of executable skill tasks',
    categories: ['world_management'],
  },
  EXPLORER: {
    name: 'Explorer',
    role: 'Scout & Cartographer',
    description: 'Maps the terrain, discovers biomes, structures, caves, forests, and building sites',
    categories: ['movement', 'exploration'],
  },
  MINER: {
    name: 'Miner',
    role: 'Resource Extraction & Mining',
    description: 'Mines stone, coal, iron, gold, redstone, lapis, diamonds, and digs tunnels',
    categories: ['resource_gathering', 'movement'],
  },
  BUILDER: {
    name: 'Builder',
    role: 'Construction & Architecture',
    description: 'Builds houses, watchtowers, bridges, defensive walls, and executes blueprints',
    categories: ['building', 'movement'],
  },
  SURVIVAL: {
    name: 'Survival',
    role: 'Safety & Combat Defender',
    description: 'Monitors vital stats, handles threat evasion, equips armor/weapons, and engages hostile mobs',
    categories: ['survival', 'combat', 'movement'],
  },
  CRAFTER: {
    name: 'Crafter',
    role: 'Equipment Manufacturing & Smelting',
    description: 'Crafts tools, crafting tables, furnaces, weapons, armor, and smelts raw ores',
    categories: ['crafting', 'inventory'],
  },
  COMBAT: {
    name: 'Combat',
    role: 'Threat Response & Base Defense',
    description: 'Detects hostile entities, evaluates threats, fights when safe, and recovers after combat',
    categories: ['combat', 'survival', 'movement'],
  },
  MEMORY: {
    name: 'Memory',
    role: 'Persistent World & Team Memory',
    description: 'Stores and retrieves verified observations, experiences, reservations, discoveries, and team history',
    categories: ['inventory', 'world_management'],
  },
  RESEARCHER: {
    name: 'Researcher',
    role: 'Learning, Memory & Recovery',
    description: 'Extracts lessons learned from past successes/failures, prevents repeat errors',
    categories: ['world_management'],
  },
}

class AgentRegistry {
  constructor() {
    this.agents = new Map()
    this.initAgents()
  }

  initAgents() {
    for (const [key, def] of Object.entries(AGENT_ROLES)) {
      const agentId = `agent_${key.toLowerCase()}`
      this.agents.set(def.name.toLowerCase(), {
        id: agentId,
        ...def,
        status: 'online',
        lastActive: Date.now(),
      })
      memoryStore.upsertAgent(def.name, def.role, 'online', agentId)
    }
    log.info(`Initialized all ${this.agents.size} squad agents in registry`)
  }

  getAgent(name) {
    return this.agents.get(name.toLowerCase())
  }

  listAgents() {
    return Array.from(this.agents.values())
  }

  /**
   * Determine which specialized agent should execute a skill
   */
  resolveAgentForSkill(skill) {
    if (!skill) return this.getAgent('Commander')

    switch (skill.category) {
      case 'exploration':
        return this.getAgent('Explorer')
      case 'resource_gathering':
        return this.getAgent('Miner')
      case 'building':
        return this.getAgent('Builder')
      case 'food_farming':
        return this.getAgent('Survival')
      case 'survival':
        return this.getAgent('Survival')
      case 'combat':
        return this.getAgent('Combat')
      case 'crafting':
        return this.getAgent('Crafter')
      case 'inventory':
        return this.getAgent('Memory')
      default:
        return this.getAgent('Commander')
    }
  }

  isAuthorizedForSkill(agentName, skill) {
    const agent = this.getAgent(agentName)
    if (!agent) return false
    if (agent.categories.includes('*')) return true
    return agent.categories.includes(skill.category)
  }
}

export const agentRegistry = new AgentRegistry()
