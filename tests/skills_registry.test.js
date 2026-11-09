import test from 'node:test';
import assert from 'node:assert/strict';
import { skillRegistry } from '../src/skills/registry.js';
import { SkillExecutor } from '../src/skills/executor.js';
import '../src/skills/index.js';

test('SkillRegistry contains all registered skills across all 10 categories', () => {
  const allSkills = skillRegistry.list();
  assert.ok(allSkills.length >= 25, `Expected at least 25 skills, found ${allSkills.length}`);

  const categories = [
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
  ];

  for (const cat of categories) {
    const inCat = skillRegistry.getByCategory(cat);
    assert.ok(inCat.length > 0, `Category ${cat} should have registered skills`);
  }
});

test('SkillRegistry looks up skills by ID and category', () => {
  const follow = skillRegistry.get('follow_player');
  assert.ok(follow, 'follow_player skill should exist');
  assert.equal(follow.category, 'movement');

  const wood = skillRegistry.get('collect_wood');
  assert.ok(wood, 'collect_wood skill should exist');
  assert.equal(wood.category, 'resource_gathering');

  const house = skillRegistry.get('build_small_house');
  assert.ok(house, 'build_small_house skill should exist');
  assert.equal(house.category, 'building');
});

test('SkillRegistry rejects invalid skill definitions', () => {
  assert.throws(() => {
    skillRegistry.register({ id: '', name: 'Invalid' });
  });
});

test('SkillRegistry preserves skill versions in capability metadata', () => {
  const local = new (skillRegistry.constructor)();
  local.register({
    id: 'versioned_test_skill',
    version: '2.1.0',
    name: 'Versioned Test Skill',
    category: 'world_management',
    description: 'Test skill metadata',
    execute: async () => ({ success: true }),
  });
  assert.equal(local.list()[0].version, '2.1.0');
});

test('SkillExecutor enforces declared inventory resources', async () => {
  const local = new (skillRegistry.constructor)();
  local.register({
    id: 'resource_guard_test',
    name: 'Resource Guard Test',
    category: 'world_management',
    description: 'Test declared resources',
    resources: [{ item: 'iron_ingot', quantity: 2 }],
    execute: async () => ({ success: true }),
  });
  const executor = new SkillExecutor(local);
  const result = await executor.execute({ version: '1.20.1', inventory: { items: () => [{ name: 'iron_ingot', count: 1 }] } }, 'resource_guard_test');
  assert.equal(result.success, false);
  assert.equal(result.failureClass, 'MISSING_RESOURCE');
});

test('collect_wood accepts verified existing inventory', async () => {
  const skill = skillRegistry.get('collect_wood');
  const result = await skill.execute({ inventory: { items: () => [{ name: 'oak_log', count: 8 }] } }, { woodType: 'oak', quantity: 4 }, {});
  assert.equal(result.success, true);
  assert.equal(result.existing, 8);
  assert.equal(result.collected, 0);
});

