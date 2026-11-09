import { config } from "../src/config/config.js";
import { createMinecraftBot } from "../src/integrations/minecraft.js";
import { taskExecutor } from "../src/tasks/task_executor.js";
import { BenchmarkRunner } from "../src/evaluation/benchmark.js";
import "../src/skills/index.js";

if (process.env.LIVE_TESTS !== "1")
  throw new Error("Live tests require LIVE_TESTS=1");

const configuredDefinition = config.minecraft.bots?.[0] ?? config.minecraft;
const testUsername =
  process.env.LIVE_TEST_USERNAME ?? `Test_${Date.now().toString(36).slice(-6)}`;
const definition = { ...configuredDefinition, username: testUsername };
if (definition.username === "newbee")
  throw new Error("Live tests refuse the production username newbee");
const instruction =
  process.env.LIVE_INSTRUCTION ??
  (process.argv.slice(2).join(" ") ||
    "inspect inventory and scan nearby environment");
const bot = createMinecraftBot(definition, () => {});
await new Promise((resolve, reject) => {
  const onError = (error) => {
    cleanup();
    reject(error);
  };
  const onSpawn = () => {
    cleanup();
    resolve();
  };
  const cleanup = () => {
    bot.removeListener("error", onError);
    bot.removeListener("spawn", onSpawn);
  };
  bot.once("error", onError);
  bot.once("spawn", onSpawn);
});

taskExecutor.setBot(bot);
try {
  const result = await new BenchmarkRunner({ executor: taskExecutor }).run({
    label: "live perception smoke",
    instruction,
    mode: "live",
    timeoutMs: Number(process.env.LIVE_TIMEOUT_MS ?? 60000),
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
} finally {
  taskExecutor.emergencyStop();
  try {
    bot.quit("Smoke test finished");
  } catch {
    /* already disconnected */
  }
}
