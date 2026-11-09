import test from 'node:test';
import assert from 'node:assert/strict';
import { isAuthorizedTelegramMessage } from '../src/integrations/telegram.js';

const config = { ownerId: '12345', groupId: '-10067890' };

test('authorizes only the configured owner in the configured group or a private chat', () => {
  assert.equal(isAuthorizedTelegramMessage({
    from: { id: 12345 },
    chat: { id: -10067890, type: 'supergroup' },
  }, config), true);

  assert.equal(isAuthorizedTelegramMessage({
    from: { id: 12345 },
    chat: { id: 12345, type: 'private' },
  }, config), true);
});

test('rejects other group members and the owner in unconfigured groups', () => {
  assert.equal(isAuthorizedTelegramMessage({
    from: { id: 99999 },
    chat: { id: -10067890, type: 'supergroup' },
  }, config), false);

  assert.equal(isAuthorizedTelegramMessage({
    from: { id: 12345 },
    chat: { id: -10011111, type: 'group' },
  }, config), false);
});
