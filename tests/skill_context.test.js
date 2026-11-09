import test from 'node:test'
import assert from 'node:assert/strict'
import { createSkillContext } from '../src/skills/context.js'
import minecraftData from 'minecraft-data'

test('skill context exposes pathfinder goals required by movement skills', () => {
  const bot = {
    version: '1.20.1',
    registry: minecraftData('1.20.1'),
    inventory: { items: () => [], slots: [] },
    entities: {},
  }
  const context = createSkillContext(bot, 'follow_player')
  assert.equal(typeof context.GoalFollow, 'function')
  assert.equal(typeof context.Movements, 'function')
  assert.equal(context.goals.GoalFollow, context.GoalFollow)
})
