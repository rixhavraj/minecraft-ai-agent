import test from 'node:test';
import assert from 'node:assert/strict';
import { taskPlanner } from '../src/tasks/task_planner.js';
import '../src/skills/index.js';

test('TaskPlanner decomposes "Collect 32 oak logs and build a small house"', () => {
  const plan = taskPlanner.plan('Collect 32 oak logs and build a small house');
  assert.ok(plan.tasks.length >= 5, `Expected >= 5 subtasks, got ${plan.tasks.length}`);

  const skillIds = plan.tasks.map(t => t.skillId);
  assert.ok(skillIds.includes('find_forest') || skillIds.includes('collect_wood'));
  assert.ok(skillIds.includes('build_small_house') || skillIds.includes('build_structure'));
  assert.ok(skillIds.includes('find_building_location') || skillIds.includes('clear_area'));

  // Verify agents assigned
  const agents = plan.tasks.map(t => t.agent);
  assert.ok(agents.includes('Miner') || agents.includes('Explorer'));
  assert.ok(agents.includes('Builder'));
});

test('TaskPlanner decomposes mining requests', () => {
  const plan = taskPlanner.plan('mine 16 iron');
  assert.ok(plan.tasks.length >= 2);
  const skillIds = plan.tasks.map(t => t.skillId);
  assert.ok(skillIds.includes('collect_ore'));
  assert.ok(skillIds.includes('craft_stone_tools'), 'Mining iron should prepare a stone pickaxe');
  assert.ok(skillIds.includes('collect_stone'), 'Mining iron should gather cobblestone first');
});

test('TaskPlanner prepares materials before crafting an axe', () => {
  const plan = taskPlanner.plan('build a axe');
  const skillIds = plan.tasks.map(t => t.skillId);
  assert.ok(skillIds.includes('collect_wood'));
  assert.ok(skillIds.includes('craft_planks'));
  assert.ok(skillIds.includes('craft_item'));
  assert.equal(plan.tasks.find(t => t.skillId === 'craft_planks').args.count, 2);
});

test('TaskPlanner decomposes farming requests', () => {
  const plan = taskPlanner.plan('create a farm');
  assert.ok(plan.tasks.length >= 1);
  const skillIds = plan.tasks.map(t => t.skillId);
  assert.ok(skillIds.includes('build_sustainable_farm'));
});

test('TaskPlanner decomposes combat requests', () => {
  const plan = taskPlanner.plan('protect the base');
  assert.ok(plan.tasks.length >= 2);
  const skillIds = plan.tasks.map(t => t.skillId);
  assert.ok(skillIds.includes('equip_best_weapon') || skillIds.includes('defend_base'));
});

test('TaskPlanner creates the clean-world acceptance sequence', () => {
  const plan = taskPlanner.plan('run the clean world survival bootstrap acceptance test');
  assert.deepEqual(plan.tasks.map(step => step.skillId), [
    'collect_wood', 'craft_planks', 'craft_crafting_table', 'place_crafting_table', 'craft_wooden_tools', 'collect_stone',
    'craft_stone_tools', 'find_food', 'eat_food', 'collect_ore', 'smelt_ores',
    'craft_item', 'build_small_house', 'save_base',
  ]);
  assert.ok(plan.tasks.every(step => ['Commander', 'Crafter', 'Explorer', 'Miner', 'Survival', 'Builder'].includes(step.agent)));
});

test('TaskPlanner routes coordinate commands to verified navigation', () => {
  const plan = taskPlanner.plan('Go to 199 64 162');
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].skillId, 'goto_position');
  assert.deepEqual(plan.tasks[0].args, { x: 199, y: 64, z: 162 });
});

test('TaskPlanner routes emergency escape to the real movement skill', () => {
  const plan = taskPlanner.plan('escape danger', 'Survival');
  assert.deepEqual(plan.tasks.map(step => step.skillId), ['escape_danger']);
});

