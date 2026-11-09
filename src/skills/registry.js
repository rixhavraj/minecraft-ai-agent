import { z } from 'zod'
import { logger } from '../utils/logger.js'

const CATEGORIES = [
  'movement',
  'exploration',
  'resource_gathering',
  'food_farming',
  'survival',
  'crafting',
  'inventory',
  'building',
  'combat',
  'world_management',
]

const skillDefinitionSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1).default('1.0.0'),
  name: z.string().min(1),
  category: z.enum(CATEGORIES),
  description: z.string().min(1),
  arguments: z.record(z.any()).default({}),
  requires: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default(['*']),
  resources: z.array(z.object({ item: z.string().min(1), quantity: z.number().int().positive() })).default([]),
  timeout: z.number().int().positive().default(60_000),
  precondition: z.function().optional(),
  execute: z.function(),
  verify: z.function().optional(),
  recover: z.function().optional(),
})

/**
 * Centralized registry that stores all skill definitions.
 * Skills register themselves via `register()` and are looked up
 * by id or category at execution time.
 */
class SkillRegistry {
  constructor() {
    /** @type {Map<string, import('zod').infer<typeof skillDefinitionSchema>>} */
    this._skills = new Map()
    this._log = logger.child({ component: 'SkillRegistry' })
  }

  /**
   * Register a skill definition.
   * Validates the definition with Zod and checks that all declared
   * dependency skill IDs are already registered.
   *
   * @param {object} definition  Raw skill definition object.
   * @returns {void}
   * @throws {Error} on validation failure or missing dependency.
   */
  register(definition) {
    const result = skillDefinitionSchema.safeParse(definition)
    if (!result.success) {
      const details = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')
      throw new Error(`Invalid skill definition "${definition?.id ?? 'unknown'}": ${details}`)
    }

    const skill = result.data

    if (this._skills.has(skill.id)) {
      throw new Error(`Skill "${skill.id}" is already registered`)
    }

    // Store skill definition
    this._skills.set(skill.id, skill)
    this._log.debug({ skillId: skill.id, category: skill.category }, 'Skill registered')
  }

  /**
   * Validate that all declared dependencies are satisfied across all registered skills.
   * @returns {{ valid: boolean, missing: Array<{ skillId: string, dependency: string }> }}
   */
  validateDependencies() {
    const missing = []
    for (const skill of this._skills.values()) {
      for (const depId of skill.requires) {
        if (!this._skills.has(depId)) {
          missing.push({ skillId: skill.id, dependency: depId })
        }
      }
    }
    return { valid: missing.length === 0, missing }
  }

  /**
   * Look up a skill by its unique id.
   *
   * @param {string} id
   * @returns {object|undefined}
   */
  get(id) {
    return this._skills.get(id)
  }

  /**
   * Return all skills that belong to a category.
   *
   * @param {string} category
   * @returns {object[]}
   */
  getByCategory(category) {
    const results = []
    for (const skill of this._skills.values()) {
      if (skill.category === category) results.push(skill)
    }
    return results
  }

  /**
   * List every registered skill (metadata only, no functions).
   *
   * @returns {{ id: string, name: string, category: string, description: string, requires: string[], permissions: string[], timeout: number, arguments: object }[]}
   */
  list() {
    const entries = []
    for (const skill of this._skills.values()) {
      entries.push({
        id: skill.id,
        version: skill.version,
        name: skill.name,
        category: skill.category,
        description: skill.description,
        requires: skill.requires,
        permissions: skill.permissions,
        resources: skill.resources,
        timeout: skill.timeout,
        arguments: skill.arguments,
      })
    }
    return entries
  }

  /**
   * Check whether a skill id is registered.
   *
   * @param {string} id
   * @returns {boolean}
   */
  has(id) {
    return this._skills.has(id)
  }

  /**
   * Total number of registered skills.
   *
   * @returns {number}
   */
  get size() {
    return this._skills.size
  }

  /**
   * Remove a skill by id (useful in tests).
   *
   * @param {string} id
   * @returns {boolean}
   */
  unregister(id) {
    // Prevent removal if other skills depend on this one
    for (const skill of this._skills.values()) {
      if (skill.requires.includes(id)) {
        throw new Error(
          `Cannot unregister "${id}": skill "${skill.id}" depends on it`,
        )
      }
    }
    const deleted = this._skills.delete(id)
    if (deleted) this._log.debug({ skillId: id }, 'Skill unregistered')
    return deleted
  }
}

/** Singleton skill registry shared across the application. */
export const skillRegistry = new SkillRegistry()

export { CATEGORIES, skillDefinitionSchema, SkillRegistry }
