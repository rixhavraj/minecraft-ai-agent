import test from 'node:test';
import assert from 'node:assert/strict';
import { taskExecutor } from '../src/tasks/task_executor.js';
import '../src/skills/index.js';

test('TaskExecutor handles pause, resume, cancel, and emergency stop', async () => {
  assert.equal(taskExecutor.isPaused, false);

  taskExecutor.pause();
  assert.equal(taskExecutor.isPaused, true);
  let status = taskExecutor.getStatus();
  assert.equal(status.isPaused, true);

  taskExecutor.resume();
  assert.equal(taskExecutor.isPaused, false);

  taskExecutor.emergencyStop();
  assert.equal(taskExecutor.isEmergencyStopped, true);
  status = taskExecutor.getStatus();
  assert.equal(status.isEmergencyStopped, true);

  // Submitting while stopped should throw
  await assert.rejects(async () => {
    await taskExecutor.submitCommand('walk forward', 1);
  });

  taskExecutor.resetEmergencyStop();
  assert.equal(taskExecutor.isEmergencyStopped, false);
});

