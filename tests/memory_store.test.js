import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from '../src/database/memory_store.js';

test('MemoryStore records and retrieves tasks and status lifecycle', () => {
  const taskId = memoryStore.createTask('Mine 64 coal', 2);
  assert.ok(taskId);

  let task = memoryStore.getTask(taskId);
  assert.equal(task.instruction, 'Mine 64 coal');
  assert.equal(task.status, 'received');

  memoryStore.updateTaskStatus(taskId, 'executing');
  task = memoryStore.getTask(taskId);
  assert.equal(task.status, 'execution');
  assert.ok(task.started_at);

  memoryStore.updateTaskStatus(taskId, 'completed', { coalCollected: 64 });
  task = memoryStore.getTask(taskId);
  assert.equal(task.status, 'completed');
  assert.ok(task.completed_at);
});

test('MemoryStore records and finds relevant lessons learned', () => {
  memoryStore.recordLesson('mining_tip', 'Creeper exploded near gravel vein', 'Survival', null, 1);

  const lessons = memoryStore.findRelevantLessons('gravel vein mining');
  assert.ok(lessons.length > 0);
  assert.ok(lessons[0].content.includes('gravel'));
});

test('MemoryStore persists and retrieves blueprints', () => {
  const bp = { name: 'Tower', layers: [{ y: 0, blocks: [] }] };
  memoryStore.saveBlueprint('Tower', bp, 1);

  const loaded = memoryStore.getBlueprint('Tower');
  assert.ok(loaded);
  assert.equal(loaded.name, 'Tower');
});
