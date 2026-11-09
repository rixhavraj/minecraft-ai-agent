import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../src/config/config.js';

test('configuration provides safe local MySQL defaults without a fixed Minecraft port', () => {
  const result = parseConfig({});

  assert.equal(result.app.environment, 'development');
  assert.equal(result.database.host, '127.0.0.1');
  assert.equal(result.database.port, 3306);
  assert.equal(result.database.user, 'root');
  assert.equal(result.database.name, 'minecraft_ai_squad');
  assert.equal(result.minecraft.host, 'localhost');
  assert.equal(result.minecraft.port, undefined);
  assert.equal(result.telegram.botToken, undefined);
});

test('configuration parses integration values and rejects invalid ports', () => {
  const result = parseConfig({
    MYSQL_HOST: 'db.local',
    MYSQL_PORT: '3307',
    MYSQL_USER: 'squad',
    MYSQL_PASSWORD: 'local-password',
    MYSQL_DATABASE: 'squad_db',
    MINECRAFT_PORT: '25575',
    TELEGRAM_OWNER_ID: '12345',
    OLLAMA_BASE_URL: 'http://localhost:11434',
  });

  assert.equal(result.database.host, 'db.local');
  assert.equal(result.database.port, 3307);
  assert.equal(result.database.user, 'squad');
  assert.equal(result.database.password, 'local-password');
  assert.equal(result.database.name, 'squad_db');
  assert.equal(result.minecraft.port, 25575);
  assert.equal(result.telegram.ownerId, '12345');
  assert.throws(
    () => parseConfig({ MINECRAFT_PORT: '70000' }),
    /minecraft\.port/,
  );
  assert.throws(
    () => parseConfig({ MYSQL_PORT: '70000' }),
    /database\.port/,
  );
});

test('configuration supports Groq alongside OpenRouter', () => {
  const result = parseConfig({ MODEL_PROVIDER: 'groq', GROQ_API_KEY: 'local-test-key', GROQ_MODEL: 'llama-test' });
  assert.equal(result.providers.provider, 'groq');
  assert.equal(result.providers.groqApiKey, 'local-test-key');
  assert.equal(result.providers.groqModel, 'llama-test');
});

test('configuration supports Google and ordered provider fallback', () => {
  const result = parseConfig({ MODEL_PROVIDER: 'auto', MODEL_PROVIDER_ORDER: 'google,groq,openrouter', GOOGLE_API_KEY: 'local-google-key' });
  assert.equal(result.providers.provider, 'auto');
  assert.deepEqual(result.providers.providerOrder, ['google', 'groq', 'openrouter']);
  assert.equal(result.providers.googleApiKey, 'local-google-key');
});
