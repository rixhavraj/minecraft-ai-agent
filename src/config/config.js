import 'dotenv/config';
import { z } from 'zod';

const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().optional(),
);

const optionalPort = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.coerce.number().int().min(1).max(65535).optional(),
);

const optionalBoolean = z.preprocess(
  (value) => value == null || value === '' ? false : value === true || value === 'true' || value === '1',
  z.boolean(),
);

const botDefinition = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  username: z.string().min(1),
  worldId: optionalString,
  version: optionalString,
  auth: z.enum(['offline', 'microsoft']).default('offline'),
});

const configSchema = z.object({
  app: z.object({
    environment: z.enum(['development', 'test', 'production']).default('development'),
    logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  }),
  database: z.object({
    host: z.string().min(1).default('127.0.0.1'),
    port: optionalPort.default(3306),
    user: z.string().min(1).default('root'),
    password: optionalString.default(''),
    name: z.string().min(1).default('minecraft_ai_squad'),
  }),
  minecraft: z.object({
    host: z.string().min(1).default('localhost'),
    port: optionalPort,
    version: optionalString,
    username: optionalString,
    worldId: optionalString,
    auth: z.enum(['offline', 'microsoft']).default('offline'),
    bots: z.array(botDefinition).default([]),
  }),
  telegram: z.object({
    botToken: optionalString,
    ownerId: optionalString,
    groupId: optionalString,
  }),
  providers: z.object({
    provider: z.enum(['auto', 'openrouter', 'groq', 'google', 'ollama', 'huggingface']).default('auto'),
    providerOrder: z.array(z.enum(['openrouter', 'groq', 'google', 'ollama', 'huggingface'])).default(['groq', 'openrouter', 'google', 'ollama', 'huggingface']),
    openRouterApiKey: optionalString,
    openRouterModel: z.string().min(1).default('openai/gpt-4o-mini'),
    groqApiKey: optionalString,
    groqModel: z.string().min(1).default('openai/gpt-oss-20b'),
    googleApiKey: optionalString,
    googleModel: z.string().min(1).default('gemini-3.8-flash'),
    ollamaBaseUrl: z.string().url().default('http://localhost:11434'),
    ollamaModel: z.string().min(1).default('llama3.1:8b'),
    huggingFaceApiKey: optionalString,
    huggingFaceModel: z.string().min(1).default('HuggingFaceH4/zephyr-7b-beta'),
  }),
  autonomy: z.object({
    enabled: optionalBoolean.default(false),
    intervalMs: z.coerce.number().int().min(5000).default(5000),
  }),
  dashboard: z.object({ enabled: optionalBoolean.default(false), port: optionalPort.default(8787) }),
  recovery: z.object({ enabled: optionalBoolean.default(false) }),
});

export function parseConfig(env = process.env) {
  let bots = [];
  if (env.MINECRAFT_BOTS) {
    try { bots = JSON.parse(env.MINECRAFT_BOTS); } catch { throw new Error('MINECRAFT_BOTS must be valid JSON'); }
  }
  const parsed = configSchema.safeParse({
    app: {
      environment: env.APP_ENV,
      logLevel: env.LOG_LEVEL,
    },
    database: {
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      user: env.MYSQL_USER,
      password: env.MYSQL_PASSWORD,
      name: env.MYSQL_DATABASE,
    },
    minecraft: {
      host: env.MINECRAFT_HOST,
      port: env.MINECRAFT_PORT,
      version: env.MINECRAFT_VERSION,
      username: env.MINECRAFT_USERNAME,
      worldId: env.MINECRAFT_WORLD_ID,
      auth: env.MINECRAFT_AUTH,
      bots,
    },
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN,
      ownerId: env.TELEGRAM_OWNER_ID,
      groupId: env.TELEGRAM_GROUP_ID,
    },
    providers: {
      provider: env.MODEL_PROVIDER,
      providerOrder: env.MODEL_PROVIDER_ORDER?.split(',').map((value) => value.trim()).filter(Boolean),
      openRouterApiKey: env.OPENROUTER_API_KEY,
      openRouterModel: env.OPENROUTER_MODEL,
      groqApiKey: env.GROQ_API_KEY,
      groqModel: env.GROQ_MODEL,
      googleApiKey: env.GOOGLE_API_KEY ?? env.GEMINI_API_KEY,
      googleModel: env.GOOGLE_MODEL,
      ollamaBaseUrl: env.OLLAMA_BASE_URL,
      ollamaModel: env.OLLAMA_MODEL,
      huggingFaceApiKey: env.HUGGINGFACE_API_KEY,
      huggingFaceModel: env.HUGGINGFACE_MODEL,
    },
    autonomy: {
      enabled: env.AUTONOMY_ENABLED,
      intervalMs: env.AUTONOMY_INTERVAL_MS,
    },
    dashboard: { enabled: env.DASHBOARD_ENABLED, port: env.DASHBOARD_PORT },
    recovery: { enabled: env.TASK_RECOVERY_ENABLED },
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }

  return parsed.data;
}

export const config = parseConfig();
