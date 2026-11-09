import test from 'node:test'
import assert from 'node:assert/strict'
import { NPCBehaviourController } from '../src/agents/npc_behaviour_controller.js'

function bot({ health = 20, food = 20, timeOfDay = 1000 } = {}) {
  return { health, food, time: { timeOfDay }, entity: { position: { x: 1, y: 64, z: 2 } } }
}

test('NPC behaviour selects profession work during daytime', () => {
  const controller = new NPCBehaviourController(bot(), {}, { profession: 'farmer' })
  assert.deepEqual(controller.chooseActivity(), { state: 'working', activity: 'farmer routine', instruction: 'inspect the farm and harvest mature crops' })
})

test('NPC behaviour prioritizes emergency survival over profession', () => {
  const controller = new NPCBehaviourController(bot({ health: 5 }), {}, { profession: 'miner' })
  assert.equal(controller.chooseActivity().instruction, 'escape danger')
})

test('NPC profession and home are validated and exposed', () => {
  const controller = new NPCBehaviourController(bot(), {}, {})
  controller.setProfession('builder')
  controller.setHome({ x: 10, y: 64, z: -3 })
  assert.equal(controller.getStatus().profession, 'builder')
  assert.deepEqual(controller.getStatus().home, { x: 10, y: 64, z: -3 })
  assert.throws(() => controller.setProfession('pilot'), /Unsupported profession/)
})
