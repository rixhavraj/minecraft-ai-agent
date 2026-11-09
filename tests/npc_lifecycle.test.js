import test from 'node:test'
import assert from 'node:assert/strict'
import { NPCStateMachine } from '../src/npc/npcStateMachine.js'
import { RoutineScheduler } from '../src/npc/routineScheduler.js'

test('NPC state machine validates and records transitions', () => {
  const machine = new NPCStateMachine()
  machine.transition('WORKING', 'daytime profession')
  assert.equal(machine.snapshot().state, 'WORKING')
  assert.throws(() => machine.transition('INVALID'), /Unknown NPC state/)
})

test('routine scheduler separates day, evening, and night', () => {
  const scheduler = new RoutineScheduler()
  assert.equal(scheduler.phase(1000), 'DAY')
  assert.equal(scheduler.phase(11500), 'EVENING')
  assert.equal(scheduler.phase(14000), 'NIGHT')
})
