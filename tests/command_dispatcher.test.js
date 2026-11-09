import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchCommand } from '../src/integrations/command_dispatcher.js';
import '../src/skills/index.js';

test('CommandDispatcher handles /help', async () => {
  const reply = await dispatchCommand('/help');
  assert.ok(reply.includes('/status'));
  assert.ok(reply.includes('/agents'));
  assert.ok(reply.includes('/skills'));
});

test('CommandDispatcher handles /agents', async () => {
  const reply = await dispatchCommand('/agents');
  assert.ok(reply.includes('Commander'));
  assert.ok(reply.includes('Miner'));
  assert.ok(reply.includes('Builder'));
});

test('CommandDispatcher handles /skills', async () => {
  const reply = await dispatchCommand('/skills');
  assert.ok(reply.includes('Registered Gameplay Skills'));
  assert.ok(reply.includes('MOVEMENT'));
  assert.ok(reply.includes('RESOURCE_GATHERING'));
});

test('CommandDispatcher handles /status with mock bot', async () => {
  const mockBot = {
    entity: { position: { x: 10, y: 64, z: 20 } },
    health: 20,
    food: 18,
  };
  const reply = await dispatchCommand('/status', { bot: mockBot });
  assert.ok(reply.includes('Squad Status'));
  assert.ok(reply.includes('Health: 20/20'));
});

test('CommandDispatcher routes natural language instructions to task executor', async () => {
  const reply = await dispatchCommand('Build a house and find food');
  assert.ok(reply.includes('Commander received objective'));
  assert.ok(reply.includes('Strategist is planning execution steps'));
});

test('CommandDispatcher changes the live NPC profession', async () => {
  let assigned = null
  const reply = await dispatchCommand('Become a farmer', { npcController: { setProfession: (value) => { assigned = value; return value } } })
  assert.equal(assigned, 'farmer')
  assert.match(reply, /assigned as a farmer/)
})

