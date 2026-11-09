/**
 * Skills barrel export and self-registration.
 *
 * Imports all skill modules to populate the centralized SkillRegistry,
 * and re-exports the registry, executor, and context constructors.
 */

export { skillRegistry, SkillRegistry, CATEGORIES, skillDefinitionSchema } from './registry.js'
export { skillExecutor, SkillExecutor, BotMutex } from './executor.js'
export { createSkillContext, GoalBlock, GoalFollow, GoalNear, GoalXZ, GoalGetToBlock } from './context.js'

// ── Auto-register all core skill modules ────────────────────────────────────
import './movement.js'
import './resource_gathering.js'
import './exploration.js'
import './food_farming.js'
import './survival_skills.js'
import './crafting.js'
import './inventory.js'
import './building.js'
import './combat.js'
import './world_management.js'
import './villager.js'
import './enchanting.js'
import './transportation.js'
import './redstone.js'
import './progression.js'
