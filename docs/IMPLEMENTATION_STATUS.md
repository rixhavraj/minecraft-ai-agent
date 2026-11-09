# Implementation Status

This report records evidence, not aspirations. Live behavior is never marked successful merely because code exists.

- Unit/integration regression suite: **65 passing, 1 optional MySQL test skipped**.
- Syntax check: **passing**.
- Live smoke (`inspect inventory and scan nearby environment`): **verified previously**.
- Coordinate navigation: **not live verified**; the bot disconnected and the task correctly reported cancellation.
- Clean-world acceptance: **not verified**; the harness rejected a non-empty inventory.
- Telegram delivery: **not verified in this environment**; `chat not found` requires checking the group ID and bot membership.
- Nether/End progression and long-run leak testing: **not verified**.
- Latest LAN smoke: connection reached the server, but was blocked by `duplicate_login` because `Agent001` was already online; no world reset was performed.
- Cancellation regression: **verified**; cancelled skills no longer retry or construct stale pathfinder actions after disconnect.
- Current live UI test: **blocked**; the Windows Minecraft control bridge was unavailable, so no command was injected into the already-running session.
- Telegram resilience: **improved locally**; network failures now use bounded exponential backoff instead of logging every three seconds.
- Survival incident from live screenshot: **reproduced evidence**; Agent001 died to a creeper/spider during `collect 32 oak logs`, with no preemption. Added dangerous-threat preemption and death cancellation/respawn recovery hooks; live re-test is still required.
- Emergency-loop fix: **implemented and unit-tested**; low-health autonomy no longer creates repeated competing tasks, and emergency escape dispatch is cooldown-gated.
- Groq provider: **implemented and unit-tested** alongside OpenRouter; configure `MODEL_PROVIDER=groq`, `GROQ_API_KEY`, and optionally `GROQ_MODEL` locally.
- Provider model correction: **implemented**; Groq defaults to `openai/gpt-oss-20b`, Google defaults to `gemini-3.8-flash`, and fallback completions use 128 tokens to reduce OpenRouter credit failures.
- NPC foundation: **implemented and unit-tested**; `NPCBehaviourController` now owns profession, home, activity, state, daily time selection, and safe delegation to the existing single task executor. Live routine verification remains pending.
- Live NPC startup: **verified**; autonomy was enabled, Agent001 joined the LAN world, selected a night shelter/defense routine, equipped a weapon, detected hostiles, and executed `defend_base` through the shared executor.
- Daily-life foundation: **implemented and unit-tested**; added NPC states, time-phase scheduler, and persistent SQLite-backed home memory. Bed/sleep and complete day-night live acceptance remain unverified.
- Telegram/task reporting fix: **implemented and unit-tested**; autonomous duplicate instructions are deduplicated, and owner inventory requests now receive verified item/count results rather than only a generic success message.
- Fast direct queries: **implemented and unit-tested**; natural inventory and vital questions now read local Mineflayer state immediately instead of entering the task queue.
- Still not complete: controlled clean-world acceptance, Telegram delivery, profession execution beyond routing, farming/trading, long-run stability, and Nether/End progression.

The dashboard now exposes `/health` and `/health/components` with explicit `WORKING`, `DEGRADED`, `FAILING`, `NOT_IMPLEMENTED`, `NOT_TESTED`, and `BLOCKED` states.

Next steps: run the regression suite, run live smoke, prepare a disposable empty-inventory Survival world for `npm.cmd run acceptance:live`, then verify Telegram configuration and advanced gameplay objectives.
