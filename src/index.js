import { config } from './config/config.js';
import { openDatabase } from './database/database.js';
import { memoryStore } from './database/memory_store.js';
import { logger } from './utils/logger.js';
import { MinecraftSupervisor } from './integrations/minecraft_supervisor.js';
import { createTelegramController } from './integrations/telegram.js';
import { askModelWithFallback } from './integrations/providers.js';
import { SurvivalController } from './agents/survival.js';
import { taskExecutor } from './tasks/task_executor.js';
import { dispatchCommand } from './integrations/command_dispatcher.js';
import { PlayerStateController } from './state/player_state_controller.js';
import { NPCBehaviourController } from './agents/npc_behaviour_controller.js';
import { CognitiveLoop } from './agents/cognitive_loop.js';
import { createDashboard } from './integrations/dashboard.js';
import { SystemHealthMonitor } from './monitoring/system_health_monitor.js';

// Auto-register all 97 skills
import './skills/index.js';

async function start() {
  let database;
  let shuttingDown = false;
  const bots = new Map();
  const minecraftSupervisors = new Map();
  const survivalControllers = new Map();
  const playerStates = new Map();
  const autonomyControllers = new Map();
  let telegram;
  let dashboard;
  const healthMonitor = new SystemHealthMonitor({ getBot: () => bots.values().next().value ?? null, taskExecutor, memoryStore });
  healthMonitor.start();

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down Minecraft AI Squad');
    try {
      telegram?.stop();
      dashboard?.close();
      healthMonitor.stop();
      for (const supervisor of minecraftSupervisors.values()) supervisor.stop('Shutting down');
      for (const survival of survivalControllers.values()) survival.stop();
      for (const state of playerStates.values()) state.stop();
      for (const autonomy of autonomyControllers.values()) autonomy.stop();
      taskExecutor.emergencyStop();
      await database?.end();
    } catch (error) {
      logger.error({ err: error }, 'Shutdown error');
      process.exitCode = 1;
    }
  }

  try {
    // Attempt MySQL database connection if configured; SQLite is always active
    try {
      database = await openDatabase(config.database);
      logger.info('MySQL persistence connected and schema initialized');
    } catch (dbErr) {
      logger.warn({ err: dbErr.message }, 'MySQL unavailable; relying on primary SQLite persistent memory store');
    }

    const definitions = config.minecraft.bots.length
      ? config.minecraft.bots
      : config.minecraft.port && config.minecraft.username
        ? [{ name: config.minecraft.username, ...config.minecraft }]
        : [];

    if (!definitions.length) {
      logger.info('Minecraft integration disabled; configure MINECRAFT_PORT and MINECRAFT_USERNAME to enable it');
    }

    for (const definition of definitions) {
      const supervisor = new MinecraftSupervisor(definition, async (username, message, minecraftBot) => {
        const text = message.trim();
        // Detect commands or natural gameplay instructions
        const isCommand = text.startsWith('!') || text.startsWith('/')
          || /^(follow|come|stop|halt|wait|where|coords?|coordinates?|position|mine|build|farm|craft|explore|defend|protect|status|inv|inventory|help)\b/i.test(text)
          || /\b(follow|come here|stop|coordinates?|where)\b/i.test(text);

        if (isCommand) {
          const commandText = text.startsWith('!') || text.startsWith('/') ? text.slice(1).trim() : text;
          const reply = await dispatchCommand(commandText, { bot: minecraftBot, telegram, username, npcController: autonomyControllers.get(definition.name) });
          minecraftBot.chat(reply.slice(0, 240));
        } else if (message.length <= 180) {
          const order = config.providers.provider === 'auto' ? config.providers.providerOrder : [config.providers.provider];
          const candidates = order.map((candidateProvider) => ({ provider: candidateProvider, apiKey: candidateProvider === 'groq' ? config.providers.groqApiKey : candidateProvider === 'google' ? config.providers.googleApiKey : candidateProvider === 'huggingface' ? config.providers.huggingFaceApiKey : candidateProvider === 'openrouter' ? config.providers.openRouterApiKey : undefined, model: candidateProvider === 'groq' ? config.providers.groqModel : candidateProvider === 'google' ? config.providers.googleModel : candidateProvider === 'ollama' ? config.providers.ollamaModel : candidateProvider === 'huggingface' ? config.providers.huggingFaceModel : config.providers.openRouterModel, baseUrl: config.providers.ollamaBaseUrl }));
          if (candidates.some((candidate) => candidate.apiKey || candidate.provider === 'ollama')) {
            const answer = await askModelWithFallback({ providers: candidates,
              prompt: `You are ${definition.name}, a friendly Minecraft AI squad member. Reply briefly to ${username}: ${message}`,
            });
            minecraftBot.chat(answer.text.replace(/\s+/g, ' ').slice(0, 240));
          }
        }
      });
      minecraftSupervisors.set(definition.name, supervisor);
      supervisor.on('bot', (bot) => bots.set(definition.name, bot));
      supervisor.on('spawn', (bot) => {
        playerStates.get(definition.name)?.stop();
        survivalControllers.get(definition.name)?.stop();
        autonomyControllers.get(definition.name)?.stop();
        const playerState = new PlayerStateController(bot, { worldId: definition.worldId });
        playerState.start();
        playerStates.set(definition.name, playerState);
        playerState.on('updated', ({ state }) => {
          if (state.health != null && state.health <= 6) {
            logger.warn({ agent: definition.name, health: state.health }, 'Player state reports critical health');
          }
        });
        // Bind primary bot to autonomous task executor
        taskExecutor.setBot(bot);
        if (config.recovery.enabled) void taskExecutor.recoverUnfinishedTasks();

        const survival = new SurvivalController(bot, {
          taskExecutor,
          onEvent: (event) => {
            logger.info({ agent: definition.name, event }, 'Survival update');
            void telegram?.notify(`I noticed a survival issue: ${event}`);
          },
        });
        survival.start();
        survivalControllers.set(definition.name, survival);
        if (config.autonomy.enabled) {
          const autonomy = new NPCBehaviourController(bot, taskExecutor, { intervalMs: config.autonomy.intervalMs });
          autonomy.setCognitiveLoop(new CognitiveLoop({ bot, playerState, taskExecutor }));
          autonomy.start();
          autonomyControllers.set(definition.name, autonomy);
        }
      });
      supervisor.start();
    }

    // Keep internal lifecycle events out of Telegram. The group should read like
    // a normal conversation, not like a debug console.
    const humanProgressMessage = (update) => {
      const text = String(update).trim()
      let match

      match = text.match(/^\[TASK RECEIVED\].*?\"(.+)\"$/)
      if (match) return `I got it. I’m starting: “${match[1]}”`
      match = text.match(/^\[STEP \d+\/\d+\]\s*\(([^)]+)\)\s*->\s*(.+)$/)
      if (match) return `I’m working on it now. ${match[2]}`
      match = text.match(/^\[OBJECTIVE COMPLETED\]\s*(.*)$/)
      if (match) return `Done. ${match[1] || 'The objective was completed successfully.'}`
      match = text.match(/^\[TASK FAILED\]\s*(.*)$/)
      if (match) return `I couldn’t finish that task. ${match[1] || 'I’ll need another approach.'}`
      match = text.match(/^\[ERROR\]\s*(.*)$/)
      if (match) return `Something went wrong while I was working: ${match[1]}`
      match = text.match(/^\[CANCELLED\]\s*(.*)$/)
      if (match) return `Okay, I stopped the task. ${match[1]}`
      if (/^\[(PAUSED|RESUMED|EMERGENCY STOP|SYSTEM READY)\]/.test(text)) {
        return text.replace(/^\[[^\]]+\]\s*/, '')
      }
      return null
    }

    // Stream only useful, conversational progress to Telegram and in-game chat.
    taskExecutor.setProgressCallback((update) => {
      const humanMessage = humanProgressMessage(update)
      if (humanMessage) void telegram?.notify(humanMessage)
      for (const b of bots.values()) {
        if (humanMessage && (/^\[STEP/.test(update) || humanMessage.startsWith('Done.') || humanMessage.startsWith('I couldn’t'))) {
          b.chat(humanMessage.slice(0, 160));
        }
      }
    });

    taskExecutor.on('task:terminal', ({ task, status }) => {
      if (status !== 'completed' || ['Autonomy', 'CognitiveLoop', 'NPCBehaviour', 'Survival'].includes(task.issuerName)) return
      const verified = (task.results ?? []).map((step) => step.result).filter(Boolean)
      const inventory = verified.find((result) => Array.isArray(result.items))
      if (inventory) {
        const items = inventory.items.length ? inventory.items.map((item) => `${item.name} x${item.count}`).join(', ') : 'empty'
        void telegram?.notify(`Verified inventory: ${items}. Total items: ${inventory.totalItems}. Empty slots: ${inventory.emptySlots}.`)
      }
    })

    // Connect Telegram controller
    if (config.telegram.botToken && config.telegram.ownerId) {
      telegram = createTelegramController(config.telegram, async (message) => {
        const primaryBot = bots.values().next().value;
        return dispatchCommand(message, { bot: primaryBot, telegram, username: 'Owner', npcController: autonomyControllers.values().next().value ?? null });
      });
    } else {
      logger.info('Telegram integration disabled; configure TELEGRAM_BOT_TOKEN and TELEGRAM_OWNER_ID to enable it');
    }

    logger.info(
      {
        minecraftConfigured: bots.size > 0,
        telegramConfigured: telegram !== undefined,
        providerConfigured: config.providers.provider === 'ollama' || config.providers.openRouterApiKey !== undefined || config.providers.groqApiKey !== undefined || config.providers.googleApiKey !== undefined || config.providers.huggingFaceApiKey !== undefined,
      },
      'Minecraft AI Squad autonomous engine initialized',
    );

    if (config.dashboard.enabled) {
      const primaryBot = bots.values().next().value;
      dashboard = createDashboard({ port: config.dashboard.port, bot: primaryBot, getBot: () => bots.values().next().value, taskExecutor, healthMonitor });
      logger.info({ port: config.dashboard.port }, 'Local dashboard API enabled');
    }

    process.once('SIGINT', () => { void shutdown('SIGINT'); });
    process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  } catch (error) {
    logger.fatal({ err: error }, 'Application startup failed');
    process.exitCode = 1;
  }
}

void start();
