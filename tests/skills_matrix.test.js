import test from 'node:test';
import assert from 'node:assert/strict';
import { skillRegistry } from '../src/skills/registry.js';
import '../src/skills/index.js';

test('Test Matrix: All 10 skill categories are registered with complete metadata', () => {
  const skills = skillRegistry.list();
  assert.ok(skills.length >= 25, `Expected >= 25 skills, found ${skills.length}`);

  const requiredCategories = [
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

  for (const cat of requiredCategories) {
    const categorySkills = skillRegistry.getByCategory(cat);
    assert.ok(categorySkills.length > 0, `Category ${cat} must contain skills`);

    for (const skill of categorySkills) {
      assert.ok(skill.id, 'Skill must have an ID');
      assert.ok(skill.name, 'Skill must have a name');
      assert.ok(skill.description, 'Skill must have a description');
      assert.equal(typeof skill.execute, 'function', `Skill ${skill.id} must have execute function`);
      assert.ok(skill.timeout > 0, `Skill ${skill.id} must have a positive timeout`);
    }
  }
});

test('Test Matrix: Dependencies validation across all registered skills', () => {
  const result = skillRegistry.validateDependencies();
  assert.equal(result.valid, true, `Missing dependencies: ${JSON.stringify(result.missing)}`);
});

