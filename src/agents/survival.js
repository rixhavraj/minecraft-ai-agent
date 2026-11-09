import { logger } from '../utils/logger.js';

const FOOD_PRIORITY = [
  'cooked_beef',
  'cooked_porkchop',
  'cooked_mutton',
  'cooked_chicken',
  'cooked_rabbit',
  'cooked_salmon',
  'cooked_cod',
  'bread',
  'baked_potato',
  'carrot',
  'potato',
  'apple',
  'sweet_berries',
  'melon_slice',
  'beetroot',
  'golden_carrot',
];

const HOSTILE_MOBS = new Set([
  'blaze',
  'cave_spider',
  'creeper',
  'drowned',
  'enderman',
  'endermite',
  'evoker',
  'ghast',
  'guardian',
  'hoglin',
  'husk',
  'magma_cube',
  'phantom',
  'piglin_brute',
  'pillager',
  'ravager',
  'silverfish',
  'skeleton',
  'slime',
  'spider',
  'vex',
  'vindicator',
  'warden',
  'witch',
  'wither_skeleton',
  'zoglin',
  'zombie',
  'zombie_villager',
]);

const FOOD_ORDER = new Map(FOOD_PRIORITY.map((name, index) => [name, index]));

function distanceBetween(first, second) {
  if (!first || !second) return Infinity;
  const { x, y, z } = first;
  const dx = x - second.x;
  const dy = y - second.y;
  const dz = z - second.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function timePhase(timeOfDay) {
  if (timeOfDay == null) return null;
  const time = ((timeOfDay % 24000) + 24000) % 24000;
  if (time < 12000) return 'day';
  if (time < 13000) return 'dusk';
  if (time < 23000) return 'night';
  return 'dawn';
}

function countItem(bot, name) {
  return bot.inventory.items()
    .filter((item) => item.name === name)
    .reduce((total, item) => total + item.count, 0);
}

export class SurvivalController {
  constructor(bot, {
    onEvent = () => {},
    // Threat checks must be faster than a normal work-planning cycle.
    intervalMs = 1000,
    hungerThreshold = 14,
    criticalHealth = 6,
    threatRadius = 8,
    alertCooldownMs = 300_000,
    taskExecutor = null,
    now = Date.now,
  } = {}) {
    this.bot = bot;
    this.onEvent = onEvent;
    this.intervalMs = intervalMs;
    this.hungerThreshold = hungerThreshold;
    this.criticalHealth = criticalHealth;
    this.threatRadius = threatRadius;
    this.alertCooldownMs = alertCooldownMs;
    this.taskExecutor = taskExecutor;
    this.now = now;
    this.timer = undefined;
    this.busy = false;
    this.lastAlerts = new Map();
    this.lastDefenseAt = 0;
    this.lastEmergencyAt = 0;
    this.onDeath = () => this.handleDeath();
    this.onRespawn = () => this.emit(`${this.bot.username} respawned; survival monitoring resumed.`);
  }

  start() {
    if (this.timer) return;
    this.bot.on?.('death', this.onDeath);
    this.bot.on?.('respawn', this.onRespawn);
    void this.tick();
    this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.bot.removeListener?.('death', this.onDeath);
    this.bot.removeListener?.('respawn', this.onRespawn);
  }

  handleDeath() {
    this.bot.pathfinder?.setGoal(null);
    this.taskExecutor?.cancelCurrent?.();
    this.emit(`${this.bot.username} died; cancelled active work and waiting for respawn recovery.`);
  }

  snapshot() {
    const position = this.bot.entity?.position;
    const nearbyHostiles = Object.values(this.bot.entities ?? {})
      .filter((entity) => entity.type === 'mob'
        && HOSTILE_MOBS.has(entity.name)
        && distanceBetween(position, entity.position) <= this.threatRadius)
      .map((entity) => ({
        name: entity.name,
        distance: Number(distanceBetween(position, entity.position).toFixed(1)),
      }));
    const foods = this.bot.inventory.items()
      .filter((item) => FOOD_ORDER.has(item.name))
      .reduce((counts, item) => {
        counts[item.name] = (counts[item.name] ?? 0) + item.count;
        return counts;
      }, {});
    const rawTimeOfDay = this.bot.time?.timeOfDay;
    const timeOfDay = Number.isFinite(rawTimeOfDay) ? rawTimeOfDay : null;

    return {
      health: Number.isFinite(this.bot.health) ? this.bot.health : null,
      hunger: Number.isFinite(this.bot.food) ? this.bot.food : null,
      food: foods,
      timeOfDay,
      timePhase: timePhase(timeOfDay),
      nearbyHostiles,
    };
  }

  async tick() {
    if (this.busy || !this.bot.entity) return;
    this.busy = true;
    try {
      const state = this.snapshot();
      this.monitorThreats(state);
      if (state.health != null && state.health <= this.criticalHealth) {
        this.bot.pathfinder?.setGoal(null);
        this.taskExecutor?.cancelCurrent?.();
        this.dispatchEmergency('escape danger', 'critical health');
        this.emitThrottled(
          'critical-health',
          `${this.bot.username} has critical health (${state.health}/20); active work was cancelled and escape was dispatched.`,
        );
      } else {
        this.lastAlerts.delete('critical-health');
      }

      if (state.hunger == null || state.hunger > this.hungerThreshold) {
        this.lastAlerts.delete('no-food');
        return;
      }

      const food = this.selectFood(state.hunger);
      if (!food) {
        this.emitThrottled(
          'no-food',
          `${this.bot.username} is hungry (${state.hunger}/20) and has no suitable food available for its current hunger level.`,
        );
        return;
      }
      this.lastAlerts.delete('no-food');

      const hungerBefore = state.hunger;
      const countBefore = countItem(this.bot, food.name);
      await this.bot.equip(food, 'hand');
      await this.bot.consume();

      const hungerAfter = Number.isFinite(this.bot.food) ? this.bot.food : null;
      const countAfter = countItem(this.bot, food.name);
      if (hungerAfter != null && hungerAfter > hungerBefore) {
        this.emit(`${this.bot.username} ate ${food.name}; hunger ${hungerBefore} -> ${hungerAfter}/20.`);
      } else if (countAfter < countBefore) {
        this.emit(`${this.bot.username} consumed ${food.name}, but hunger restoration was not observed (${hungerBefore} -> ${hungerAfter ?? 'unknown'}/20).`);
      } else {
        this.emit(`${this.bot.username}'s food action was not verified; hunger remains ${hungerAfter ?? 'unknown'}/20.`);
      }
    } catch (error) {
      logger.warn({ err: error, username: this.bot.username }, 'Survival food or monitoring action failed');
      this.emitThrottled(
        'food-action-failed',
        `${this.bot.username} could not complete its survival food action.`,
      );
    } finally {
      this.busy = false;
    }
  }

  monitorThreats(state) {
    const nearest = state.nearbyHostiles
      .slice()
      .sort((first, second) => first.distance - second.distance)[0];
    if (!nearest) {
      this.lastAlerts.delete('nearby-hostile');
      return;
    }
    this.emitThrottled(
      'nearby-hostile',
      `${this.bot.username} detected nearby hostile mob ${nearest.name} (${nearest.distance} blocks).`,
    );
    const emergencyRange = nearest.name === 'creeper' ? 10 : 6;
    if (nearest.distance <= emergencyRange) {
      this.bot.pathfinder?.setGoal(null);
      this.taskExecutor?.cancelCurrent?.();
      // Any hostile inside the emergency range gets an immediate escape.
      // Combat/guard planning can happen only after the bot reaches safety.
      this.dispatchEmergency('escape danger', `${nearest.name} at ${nearest.distance} blocks`);
      this.emitThrottled('combat-preemption', `${this.bot.username} stopped its current task because ${nearest.name} is dangerously close.`);
    }
    if (this.taskExecutor && !this.taskExecutor.activeTask && !(this.taskExecutor.queue?.length) && this.now() - this.lastDefenseAt >= this.alertCooldownMs) {
      this.lastDefenseAt = this.now();
      void this.taskExecutor.submitCommand('defend nearby threats', 20, 'Survival').catch((error) => {
        logger.warn({ err: error, username: this.bot.username }, 'Automatic survival defense dispatch failed');
      });
      this.emit(`Survival dispatched a defense task for nearby ${nearest.name}.`);
    }
  }

  dispatchEmergency(instruction, reason) {
    if (!this.taskExecutor || this.now() - this.lastEmergencyAt < 15_000) return;
    this.lastEmergencyAt = this.now();
    void this.taskExecutor.submitCommand(instruction, 100, 'Survival').catch((error) => {
      logger.warn({ err: error, username: this.bot.username, instruction }, 'Emergency survival action failed to dispatch');
    });
    this.emit(`Survival dispatched ${instruction} because of ${reason}.`);
  }

  selectFood(hunger) {
    const available = this.bot.inventory.items()
      .filter((item) => FOOD_ORDER.has(item.name))
      .filter((item) => item.name !== 'golden_carrot' || hunger <= 6);
    return available.sort((first, second) => FOOD_ORDER.get(first.name) - FOOD_ORDER.get(second.name))[0];
  }

  emitThrottled(key, message) {
    const lastSent = this.lastAlerts.get(key);
    if (lastSent != null && this.now() - lastSent < this.alertCooldownMs) return;
    this.lastAlerts.set(key, this.now());
    this.emit(message);
  }

  emit(message) {
    try {
      this.onEvent(message);
    } catch (error) {
      logger.warn({ err: error, username: this.bot.username }, 'Survival event handler failed');
    }
  }
}
