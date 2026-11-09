import test from 'node:test';
import assert from 'node:assert/strict';
import { SurvivalController } from '../src/agents/survival.js';

function createBot({
  health = 20,
  food = 20,
  items = [],
  entities = {},
  timeOfDay = 1000,
} = {}) {
  const bot = {
    username: 'TestBot',
    health,
    food,
    entity: { position: { x: 0, y: 64, z: 0 } },
    entities,
    time: { timeOfDay },
    inventory: { items: () => items },
    pathfinder: { goals: [], setGoal(goal) { this.goals.push(goal); } },
    async equip(item) { this.heldItem = item; },
    async consume() {
      const item = items.find(({ name }) => name === this.heldItem.name);
      item.count -= 1;
      this.food = Math.min(20, this.food + 4);
    },
  };
  return bot;
}

test('snapshot reports hunger, food, time phase, and nearby hostile mobs', () => {
  const bot = createBot({
    health: 16,
    food: 12,
    items: [{ name: 'bread', count: 2 }],
    entities: {
      zombie: { type: 'mob', name: 'zombie', position: { x: 3, y: 64, z: 4 } },
      cow: { type: 'mob', name: 'cow', position: { x: 1, y: 64, z: 1 } },
      farSkeleton: { type: 'mob', name: 'skeleton', position: { x: 20, y: 64, z: 0 } },
    },
    timeOfDay: 14000,
  });
  const controller = new SurvivalController(bot);

  assert.deepEqual(controller.snapshot(), {
    health: 16,
    hunger: 12,
    food: { bread: 2 },
    timeOfDay: 14000,
    timePhase: 'night',
    nearbyHostiles: [{ name: 'zombie', distance: 5 }],
  });
});

test('eats supported inventory food only when hunger is low and reports observed restoration', async () => {
  const bot = createBot({
    food: 12,
    items: [
      { name: 'golden_carrot', count: 1 },
      { name: 'bread', count: 2 },
    ],
  });
  const events = [];
  const controller = new SurvivalController(bot, { onEvent: (event) => events.push(event) });

  await controller.tick();

  assert.equal(bot.heldItem.name, 'bread');
  assert.equal(bot.food, 16);
  assert.equal(events.length, 1);
  assert.match(events[0], /ate bread; hunger 12 -> 16\/20/);
});

test('does not consume food above the hunger threshold', async () => {
  const bot = createBot({
    food: 15,
    items: [{ name: 'bread', count: 1 }],
  });
  const controller = new SurvivalController(bot);

  await controller.tick();

  assert.equal(bot.food, 15);
  assert.equal(bot.heldItem, undefined);
});

test('preserves golden carrots unless hunger is critically low', async () => {
  const bot = createBot({ food: 10, items: [{ name: 'golden_carrot', count: 1 }] });
  const controller = new SurvivalController(bot);

  await controller.tick();
  assert.equal(bot.heldItem, undefined);

  bot.food = 6;
  await controller.tick();
  assert.equal(bot.heldItem.name, 'golden_carrot');
});

test('throttles missing-food alerts and stops movement at critical health', async () => {
  const events = [];
  const bot = createBot({ health: 5, food: 10 });
  const controller = new SurvivalController(bot, {
    onEvent: (event) => events.push(event),
    now: () => 1_000,
  });

  await controller.tick();
  await controller.tick();

  assert.deepEqual(bot.pathfinder.goals, [null, null]);
  assert.equal(events.filter((event) => event.includes('critical health')).length, 1);
  assert.equal(events.filter((event) => event.includes('no suitable food')).length, 1);
});

test('does not claim hunger restoration when consumption is not reflected in game state', async () => {
  const bot = createBot({ food: 10, items: [{ name: 'bread', count: 1 }] });
  bot.consume = async () => { bot.inventory.items()[0].count -= 1; };
  const events = [];
  const controller = new SurvivalController(bot, { onEvent: (event) => events.push(event) });

  await controller.tick();

  assert.match(events[0], /hunger restoration was not observed \(10 -> 10\/20\)/);
});

test('dispatches one cooldown-gated defense task for a nearby hostile', async () => {
  const calls = [];
  const bot = createBot({
    entities: { zombie: { type: 'mob', name: 'zombie', position: { x: 2, y: 64, z: 0 } } },
  });
  const controller = new SurvivalController(bot, {
    taskExecutor: { submitCommand: async (...args) => { calls.push(args); return { id: 'defense-task' }; } },
    alertCooldownMs: 1000,
    now: () => 1000,
  });
  await controller.tick();
  await controller.tick();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['defend nearby threats', 20, 'Survival']);
});

test('does not preempt ordinary work for a hostile that is only nearby', async () => {
  let cancelled = 0;
  const bot = createBot({ entities: { zombie: { type: 'mob', name: 'zombie', position: { x: 5, y: 64, z: 0 } } } });
  const controller = new SurvivalController(bot, { taskExecutor: { activeTask: { id: 'coordinate-task' }, cancelCurrent: () => { cancelled += 1; }, submitCommand: async () => ({ id: 'escape-task' }) }, now: () => 1000 });
  await controller.tick();
  assert.equal(cancelled, 0);
  assert.equal(bot.pathfinder.goals.length, 0);
});

test('preempts active work when a hostile is dangerously close', async () => {
  let cancelled = 0;
  const bot = createBot({
    entities: { creeper: { type: 'mob', name: 'creeper', position: { x: 4, y: 64, z: 0 } } },
  });
  const controller = new SurvivalController(bot, {
    taskExecutor: { cancelCurrent: () => { cancelled += 1; }, submitCommand: async () => ({ id: 'defense-task' }) },
    alertCooldownMs: 1000,
    now: () => 1000,
  });
  await controller.tick();
  assert.equal(cancelled, 1);
  assert.equal(bot.pathfinder.goals.at(-1), null);
});

test('critical health dispatches a real escape task after cancelling work', async () => {
  const calls = [];
  const bot = createBot({ health: 4, food: 20 });
  const controller = new SurvivalController(bot, {
    taskExecutor: {
      cancelCurrent: () => calls.push(['cancel']),
      submitCommand: async (...args) => { calls.push(args); return { id: 'escape-task' }; },
    },
    now: () => 20_000,
  });
  await controller.tick();
  assert.deepEqual(calls, [['cancel'], ['escape danger', 100, 'Survival']]);
});

test('does not cancel its own active escape recovery on the next survival tick', async () => {
  let cancelled = 0;
  const bot = createBot({ health: 4, food: 20 });
  const controller = new SurvivalController(bot, {
    taskExecutor: {
      activeTask: { issuerName: 'Survival', instruction: 'escape danger' },
      cancelCurrent: () => { cancelled += 1; },
      submitCommand: async () => ({ id: 'escape-task' }),
    },
    now: () => 40_000,
  });
  await controller.tick();
  assert.equal(cancelled, 0);
});
