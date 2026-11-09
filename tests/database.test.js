import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseConfig } from '../src/config/config.js';
import { openDatabase } from '../src/database/database.js';

const testDatabase = process.env.MYSQL_TEST_DATABASE;

test('MySQL initializes persistent task and memory tables', {
  skip: testDatabase ? false : 'Set MYSQL_TEST_DATABASE to run the MySQL integration test.',
}, async () => {
  const database = await openDatabase({
    ...parseConfig().database,
    name: testDatabase,
  });
  const taskId = randomUUID();

  try {
    const [rows] = await database.query(
      "SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema = DATABASE()",
    );
    const tables = rows.map(({ name }) => name);

    assert.ok(tables.includes('tasks'));
    assert.ok(tables.includes('messages'));
    assert.ok(tables.includes('memories'));
    assert.ok(tables.includes('observations'));

    await database.execute(
      'INSERT INTO tasks (id, instruction) VALUES (?, ?)',
      [taskId, 'test task'],
    );
    const [taskRows] = await database.execute(
      'SELECT instruction FROM tasks WHERE id = ?',
      [taskId],
    );
    assert.equal(taskRows[0].instruction, 'test task');
  } finally {
    await database.execute('DELETE FROM tasks WHERE id = ?', [taskId]);
    await database.end();
  }
});
