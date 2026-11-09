import mineflayer from 'mineflayer';
import pathfinderPackage from 'mineflayer-pathfinder';
import minecraftData from 'minecraft-data';
import { logger } from '../utils/logger.js';

const { pathfinder, Movements, goals } = pathfinderPackage;

export function createMinecraftBot(config, onChat) {
  const bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version,
    auth: config.auth,
  });
  bot.loadPlugin(pathfinder);
  bot.once('spawn', () => {
    const data = minecraftData(bot.version);
    bot.pathfinder.setMovements(new Movements(bot, data));
  });
  bot.once('spawn', () => logger.info({ username: config.username, host: config.host, port: config.port }, 'Commander joined Minecraft'));
  bot.on('chat', (username, message) => { if (username !== bot.username) void onChat(username, message, bot); });
  bot.on('kicked', (reason) => logger.warn({ reason }, 'Minecraft bot was kicked'));
  bot.on('error', (error) => logger.error({ err: error }, 'Minecraft bot error'));
  bot.on('end', () => logger.warn('Minecraft bot disconnected'));
  return bot;
}

export function controlMinecraftBot(bot, action) {
  if (action.type === 'stop') { bot.pathfinder.setGoal(null); return 'stopped'; }
  if (action.type === 'say') { bot.chat(action.text.slice(0, 240)); return 'said'; }
  if (action.type === 'follow') {
    const target = bot.players[action.player]?.entity;
    if (!target) return `I cannot see player ${action.player}.`;
    bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true); return `following ${action.player}`;
  }
  if (action.type === 'goto') {
    bot.pathfinder.setGoal(new goals.GoalBlock(action.x, action.y, action.z)); return `going to ${action.x}, ${action.y}, ${action.z}`;
  }
  if (action.type === 'look') {
    const target = bot.players[action.player]?.entity;
    if (!target) return `I cannot see player ${action.player}.`;
    void bot.lookAt(target.position.offset(0, 1.6, 0), true); return `looking at ${action.player}`;
  }
  return 'unknown action';
}
