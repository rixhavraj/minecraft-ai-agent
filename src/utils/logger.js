import pino from 'pino';
import { config } from '../config/config.js';

export const logger = pino({
  level: config.app.logLevel,
  redact: {
    paths: [
      'password',
      '*.password',
      'botToken',
      'telegram.botToken',
      'openRouterApiKey',
      'providers.openRouterApiKey',
      'groqApiKey',
      'providers.groqApiKey',
      'googleApiKey',
      'providers.googleApiKey',
      '*.botToken',
      '*.openRouterApiKey',
      'token',
      '*.token',
      'apiKey',
      '*.apiKey',
      'authorization',
      '*.authorization',
    ],
    censor: '[REDACTED]',
  },
  base: {
    application: 'minecraft-ai-squad',
    environment: config.app.environment,
  },
});
