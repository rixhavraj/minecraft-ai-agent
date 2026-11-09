/** Repeatable live-scenario harness. Refuses to fabricate world setup/state. */
import process from "node:process";

const instruction = process.argv.slice(2).join(" ") || "collect 4 oak logs";
const setup = process.env.SCENARIO_SETUP_COMMAND;

if (!setup) {
  console.error(
    JSON.stringify({
      status: "UNVERIFIED",
      reason: "SCENARIO_SETUP_COMMAND is not configured",
      instruction,
    }),
  );
  process.exitCode = 2;
} else {
  console.log(JSON.stringify({ status: "SETUP_REQUIRED", setup, instruction }));
  console.error(
    "Configure a real server-command channel before running scenarios.",
  );
  process.exitCode = 2;
}
