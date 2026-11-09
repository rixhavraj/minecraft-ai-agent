import { runLiveAcceptance } from "../src/evaluation/live_acceptance.js";

try {
  const result = await runLiveAcceptance();
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
} catch (error) {
  console.error(`Live acceptance failed to start: ${error.message}`);
  process.exitCode = 1;
}
