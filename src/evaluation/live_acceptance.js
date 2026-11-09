import { config as defaultConfig } from '../config/config.js'
import { createMinecraftBot } from '../integrations/minecraft.js'
import { taskExecutor } from '../tasks/task_executor.js'
import { BenchmarkRunner } from './benchmark.js'
import '../skills/index.js'

export const ACCEPTANCE_INSTRUCTION = 'run the clean world survival bootstrap acceptance test'

/**
 * Run the acceptance sequence against a real Java server. The caller must
 * provide a reproducible empty-inventory world; this function never resets or
 * fabricates world state.
 */
export async function runLiveAcceptance({ minecraft = defaultConfig.minecraft, timeoutMs = 30 * 60 * 1000 } = {}) {
  const definition = minecraft.bots?.[0] ?? minecraft
  if (!definition?.host || !definition?.port || !definition?.username) {
    throw new Error('Minecraft host, port, and username are required for live acceptance')
  }
  const bot = createMinecraftBot(definition, () => {})
  await new Promise((resolve, reject) => {
    const onError = error => { cleanup(); reject(error) }
    const onSpawn = () => { cleanup(); resolve() }
    const cleanup = () => { bot.removeListener('error', onError); bot.removeListener('spawn', onSpawn) }
    bot.once('error', onError)
    bot.once('spawn', onSpawn)
  })
  const startingItems = bot.inventory?.items?.() ?? []
  if (startingItems.length > 0) {
    try { bot.quit('Acceptance requires an empty inventory') } catch { /* already disconnected */ }
    throw new Error(`Acceptance requires an empty inventory; found ${startingItems.map(item => `${item.name} x${item.count}`).join(', ')}`)
  }
  taskExecutor.setBot(bot)
  try {
    return await new BenchmarkRunner({ executor: taskExecutor }).run({
      label: 'live clean-world acceptance',
      instruction: ACCEPTANCE_INSTRUCTION,
      mode: 'live',
      seed: process.env.MINECRAFT_WORLD_SEED ?? null,
      timeoutMs,
    })
  } finally {
    taskExecutor.emergencyStop()
    try { bot.quit('Acceptance test finished') } catch { /* already disconnected */ }
  }
}
