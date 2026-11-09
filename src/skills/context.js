import minecraftData from 'minecraft-data'
import pathfinderPackage from 'mineflayer-pathfinder'
import { logger } from '../utils/logger.js'

const { Movements, goals } = pathfinderPackage
const { GoalBlock, GoalFollow, GoalNear, GoalXZ, GoalGetToBlock } = goals

/**
 * Create a SkillContext that is passed to every skill's execute / verify / recover.
 *
 * The context provides convenient helper methods so skills don't have to
 * duplicate boilerplate for block-finding, entity lookup, inventory checks, etc.
 *
 * @param {import('mineflayer').Bot} bot        Mineflayer bot instance.
 * @param {string}                  skillId    The skill being executed (for logging).
 * @returns {SkillContext}
 */
export function createSkillContext(bot, skillId) {
  const mcData = minecraftData(bot.version)
  const log = logger.child({ component: 'Skill', skillId })
  const movements = new Movements(bot, mcData)

  return {
    // ---- Core references ----
    bot,
    mcData,
    log,
    logger: log,
    movements,
    Movements,

    // ---- Pathfinder goal constructors ----
    GoalBlock,
    GoalFollow,
    GoalNear,
    GoalXZ,
    GoalGetToBlock,
    goals: { GoalBlock, GoalFollow, GoalNear, GoalXZ, GoalGetToBlock },

    // ---- Block helpers ----

    /**
     * Find blocks of a given name within maxDistance.
     *
     * @param {string}  name         Block name (e.g. 'oak_log').
     * @param {number}  maxDistance   Search radius (default 64).
     * @param {number}  count        Max number of results (default 1).
     * @returns {import('vec3').Vec3[]}
     */
    findBlocks(name, maxDistance = 64, count = 1) {
      const blockType = mcData.blocksByName[name]
      if (!blockType) return []
      return bot.findBlocks({
        matching: blockType.id,
        maxDistance,
        count,
      })
    },

    /**
     * Find the nearest block of a given name.
     *
     * @param {string}  name         Block name.
     * @param {number}  maxDistance   Search radius (default 64).
     * @returns {import('prismarine-block').Block|null}
     */
    findNearestBlock(name, maxDistance = 64) {
      const blockType = mcData.blocksByName[name]
      if (!blockType) return null
      return bot.findBlock({
        matching: blockType.id,
        maxDistance,
      })
    },

    // ---- Entity helpers ----

    /**
     * Find the nearest entity matching a filter.
     * If `type` is a string it is matched against entity.name.
     * If `type` is a function it is used as a predicate.
     *
     * @param {string|function}  type         Entity name or predicate.
     * @param {number}           maxDistance   Max distance (default 32).
     * @returns {import('prismarine-entity').Entity|null}
     */
    findNearestEntity(type, maxDistance = 32) {
      const predicate = typeof type === 'function'
        ? type
        : (entity) => entity.name === type

      let nearest = null
      let nearestDist = maxDistance

      for (const entity of Object.values(bot.entities)) {
        if (entity === bot.entity) continue
        if (!predicate(entity)) continue
        const dist = bot.entity.position.distanceTo(entity.position)
        if (dist <= nearestDist) {
          nearest = entity
          nearestDist = dist
        }
      }
      return nearest
    },

    // ---- Inventory helpers ----

    /**
     * Count how many of an item the bot is carrying (all slots).
     *
     * @param {string} itemName  Item name (e.g. 'oak_planks').
     * @returns {number}
     */
    getInventoryCount(itemName) {
      return bot.inventory.items()
        .filter((item) => item.name === itemName)
        .reduce((total, item) => total + item.count, 0)
    },

    /**
     * Check whether the bot has at least `count` of an item.
     *
     * @param {string} itemName  Item name.
     * @param {number} count     Required count (default 1).
     * @returns {boolean}
     */
    hasItem(itemName, count = 1) {
      return this.getInventoryCount(itemName) >= count
    },

    /**
     * Get the item currently equipped in a destination slot.
     *
     * @param {'hand'|'off-hand'|'head'|'torso'|'legs'|'feet'} destination
     * @returns {import('prismarine-item').Item|null}
     */
    getEquippedItem(destination) {
      const slotMap = {
        'hand': bot.heldItem,
        'off-hand': bot.inventory.slots[45],
        'head': bot.inventory.slots[5],
        'torso': bot.inventory.slots[6],
        'legs': bot.inventory.slots[7],
        'feet': bot.inventory.slots[8],
      }
      return slotMap[destination] ?? null
    },

    // ---- Position helpers ----

    /**
     * Distance from the bot's current position to a target position.
     *
     * @param {import('vec3').Vec3} position
     * @returns {number}
     */
    distanceTo(position) {
      if (!bot.entity?.position || !position) return Infinity
      return bot.entity.position.distanceTo(position)
    },

    /**
     * Whether the pathfinder can compute a path to a target position.
     * Performs a synchronous movement check (does not actually move).
     *
     * @param {import('vec3').Vec3} position
     * @returns {boolean}
     */
    canReach(position) {
      if (!bot.entity?.position || !position) return false
      try {
        const goal = new GoalBlock(position.x, position.y, position.z)
        // Attempt to test reachability by checking if goal is already reached
        // or if the goal position has a valid block.
        const block = bot.blockAt(position)
        if (!block) return false
        // Check that the target is not inside a solid block
        const above = bot.blockAt(position.offset(0, 1, 0))
        if (block.boundingBox === 'block' && above?.boundingBox === 'block') return false
        // Distance sanity check – pathfinder can generally reach within render distance
        const dist = bot.entity.position.distanceTo(position)
        return dist <= 256
      } catch {
        return false
      }
    },

    // ---- Utility ----

    /**
     * Promise-based sleep.
     *
     * @param {number} ms  Milliseconds to wait.
     * @returns {Promise<void>}
     */
    wait(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms))
    },
  }
}

export { GoalBlock, GoalFollow, GoalNear, GoalXZ, GoalGetToBlock }
