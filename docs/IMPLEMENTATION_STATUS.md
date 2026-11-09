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
## Phase 0 / Phase 1 Evidence (2026-11-09)

## Natural Language Understanding Engine (2026-11-09)

- Implemented the NLU boundary under `src/nlp`, bounded conversation memory under `src/memory`, dependency graph validation under `src/planning`, and a 100-case benchmark under `src/evaluation`.
- The engine preserves the original message, extracts intents/entities/quantities/relative locations, preserves conditions and restrictions, resolves bounded follow-up references, detects ambiguity/cancellation conflicts, retrieves relevant persistent lessons, and validates output with Zod.
- Provider integration is advisory through the existing `askModelWithFallback` abstraction. Model output cannot execute actions and cannot bypass deterministic validation; the task executor remains the only Minecraft-action boundary.
- Natural-language Telegram dispatch now interprets and validates before submitting the original instruction to the scheduler. Validated NLU metadata is recorded as a task event.
- Verified test results: `node --test tests/nlp_engine.test.js` — 2 passing; benchmark count 100; structured validity 100%; intent accuracy and condition-preservation thresholds passing.
- Before/after regression: repository baseline recorded 68 passing + 1 skipped; after the NLU integration, `npm.cmd test` reports 70 passing + 1 skipped, 0 failing.
- NLU benchmark after classifier correction: 100 fixtures; intent accuracy 100%, requirement preservation 100%, condition preservation 100%, dependency accuracy 100%, structured-output validity 100%, 0 fixture failures.
- These are deterministic fixture results, not proof of complete natural-language coverage or live-game success.

## Phase 0 / Phase 1 Shared Intelligence Foundation (2026-11-09)

- Phase 0 audit: COMPLETE. Added `PROJECT_AUDIT.md`, `EXISTING_ARCHITECTURE.md`, `IMPLEMENTATION_ROADMAP.md`, and `INTELLIGENCE_SYSTEMS.md`.
- Phase 1 foundation: PARTIALLY IMPLEMENTED and UNIT TESTED. Added `SharedWorldState` with Zod validation, timestamped updates, subscriptions, and a central `IntelligenceOrchestrator` that schedules only through the existing `AutonomousTaskExecutor`.
- Natural-language dispatch now enters through the orchestrator after deterministic local query shortcuts, preserving the single-executor rule.
- Verification: `node --check` passed for the foundation; foundation + NLU tests passed 4/4.
- Live Minecraft verification: NOT VERIFIED in this phase. No server or credentials were changed.

## Survival preemption and coordinate navigation fix (2026-11-10)

- Fixed an over-aggressive survival loop that treated any nearby hostile as an active attack and repeatedly replaced user work with `escape danger`.
- Survival now preempts only after verified recent damage, an entity targeting the bot, an immediate close-range threat, or critical health. Nearby hostiles are observed without cancelling ordinary work.
- Explicit coordinate navigation commands receive priority 90, so they are not displaced by routine survival-defense work; only genuine emergency survival actions outrank them.
- Verified: survival tests 10/10; full regression 73 passing, 1 optional MySQL test skipped, 0 failing.
- Live Minecraft re-test is still required to confirm movement to coordinates in the user's world.

## Live navigation verification (2026-11-10)

- Real Mineflayer smoke connection: **verified**. A disposable `Agent001_LiveNav` identity joined the configured local server.
- Instruction `go to -230 60 -330`: **failed honestly**. NLU/planning selected `Explorer:goto_position`; the task timed out after 90,289 ms without verified arrival and was cancelled.
- No success was claimed and no world reset was performed. A second short-range attempt was rejected before spawn by the server with a packet-decoder error, so it is not counted as a gameplay result.
- Failure experience persisted to memory with blocker and recovery lesson: do not claim coordinate arrival; inspect path progress and retry with a controlled nearer target.

## Survival learning and recovery hardening (2026-11-10)

- Fixed a self-cancellation loop: survival no longer cancels an already-running `escape danger` recovery task on every monitoring tick.
- Escape now verifies actual movement/goal progress and reports `escape_unverified` instead of claiming success after a fixed delay.
- Existing cognitive reflection persists terminal failures and verified outcomes as experiences; the new live navigation timeout and repeated survival cancellations remain recorded as failure knowledge.
- Regression result: 74 passing, 1 optional MySQL test skipped, 0 failing.
- Live survival success is not yet verified; the next controlled test must provide a safe spawn, food, and a reachable shelter/bed so recovery can be measured without risking the user's main world.

## Conversational question routing (2026-11-10)

- Fixed simple questions such as `Do you understand my language?` being sent to the Minecraft scheduler and falling through to `scan nearby environment`.
- Added deterministic local responses for language-understanding and capability questions; these do not create tasks or compete with survival actions.
- Verified: command-dispatcher suite 7/7 passing. Restart Agent001 before testing the live Telegram conversation.

## Navigation, mining, and recovery fix (2026-11-10)

- Root causes found: `path_stop` was treated as successful navigation; movement had no bounded progress watchdog or verified-arrival result; mining checked for a tool in inventory but did not reliably craft/equip/verify the required pickaxe; and task recovery retried several identical navigation/tool failures.
- Navigation now validates coordinates and current position, monitors distance progress, detects no-path/stuck/timeout/cancelled states, cleans up listeners and goals, tries one bounded `GoalNear` alternative, and reports verified arrival only when the final distance is within the acceptance radius.
- Mining/crafting now verifies inventory changes and held-tool state. Iron/copper collection can request the stone-pickaxe prerequisite and returns a structured `TOOL_REQUIREMENT_FAILURE` when it cannot be satisfied.
- Recovery now classifies navigation and prerequisite failures as bounded/non-identical-retry cases, while preserving normal retries for recoverable failures. Structured logs include attempt number, distance, outcome, and verification state.
- Automated regression result after the fixes: **78 tests, 77 passed, 1 optional MySQL test skipped, 0 failed**.
- Live Minecraft result: **verified success**. `Agent001_NavFix3` executed `go to -230 60 -230`, made measurable progress, used the bounded alternate route after the first route timed out, reached the destination within the verification radius, and completed in 164,912 ms. The bot then disconnected because the smoke test intentionally finished.
- Limitation: this live run verifies navigation and recovery only. A live ore-mining/crafting scenario with controlled inventory and ore placement still needs a separate Minecraft fixture before claiming live mining success.

## Inventory-aware crafting and prerequisite planning (2026-11-10)

- Root cause of the original iron failure: the bot had a wooden pickaxe, but the crafting path did not recursively resolve the available acacia planks/cobblestone into sticks and a stone pickaxe. It also relied on shallow assumptions about materials and did not consistently classify or verify crafting/equipment outcomes.
- Added recipe-driven recursive prerequisite resolution in `src/skills/crafting.js`. It reads Mineflayer's version-specific `recipesFor` data, aggregates inventory stacks, distinguishes inventory recipes from crafting-table recipes, detects circular/deep dependencies, verifies inventory deltas, and verifies the held tool.
- `inspect_inventory` now returns both slot-level items and aggregated item counts. Ore collection delegates missing tool preparation to the recursive crafter and preserves the original mining objective.
- Removed unconditional oak/table/cobblestone preparation from `TaskPlanner`; actual inventory and recipe availability now determine prerequisites at execution time.
- Added structured failure classes: `MISSING_INGREDIENTS`, `MISSING_CRAFTING_TABLE`, `RECIPE_UNAVAILABLE`, `CRAFTING_FAILED`, `INVALID_ITEM`, `EQUIPMENT_FAILED`, and existing `TOOL_REQUIREMENT_FAILURE` handling.
- Automated regression result: **78 tests, 77 passed, 1 optional MySQL test skipped, 0 failed**.
- Live test script added: `scripts/live_crafting_smoke.js`. Two attempts were made, but both were rejected before spawn by the server with `Internal Exception: io.netty.handler.codec.DecoderException: Failed to decode packet 'serverbound/minecraft:hello'`. Therefore live inventory/crafting/mining success is **not verified** and no simulated success is claimed.
- Remaining limitation: rerun the live script after the server handshake/protocol issue is corrected; it uses one bot connection and will execute inventory inspection, recursive stone-pickaxe crafting, equipment verification, one-iron mining, and final inventory verification.

## Crafting knowledge and human-help foundation (2026-11-10)

- Added `src/intelligence/crafting/` recipe knowledge, version-aware recipe resolution, dependency planning, persistent verified procedure storage through the existing SQLite memory store, and bounded failure analysis.
- Unknown/invalid/circular crafting failures are now surfaced as human-help-oriented Telegram progress messages instead of being presented as successful work. Existing Telegram authorization and single polling ownership are preserved.
- Added automated coverage for recipe ingredient resolution and bounded repeated-failure handling. Updated full result: **80 tests, 79 passed, 1 optional MySQL test skipped, 0 failed**.
- This is a foundation, not a claim of complete human teaching support: structured procedure parsing, pending-task restoration after a Telegram reply, and a live chest test remain to be implemented and verified.

## Parallel intelligence foundation (2026-11-10)

- Phase 1 added a traceable event bus, bounded observation coordinator, parallel orchestrator, and read-only world/task monitors.
- Monitor failures are isolated with `Promise.allSettled`; monitors publish events and cannot invoke Minecraft actions.
- Verified with new unit tests; full suite result remains 74 passing, 1 optional MySQL test skipped, 0 failing before this addition. The focused parallel suite is the authoritative post-change check.
- Live Minecraft verification: NOT VERIFIED for continuous parallel monitoring.

- Phase 0: PARTIAL. Live environment reports Node `v24.19.0`, mineflayer `4.39.0`, minecraft-data `3.119.0`; minecraft-data supports `26.1` but not configured `26.1.2`. `.env` currently names `newbee` as the bot username. Regression suite: `68 passed, 1 skipped, 0 failed`.
- Scenario harness: UNVERIFIED. Added `npm run test:scenarios`, but no server-command channel is configured, so it refuses to fabricate `/time`, `/give`, `/tp`, or `/summon` setup.
- Phase 1: PARTIAL. `find_and_sleep` now returns explicit `not_sleep_time`, `hostile_near`, `no_bed`, `bed_too_far`, and `bed_interaction_failed` states; it selects the nearest safe bed, navigates, looks at it, sleeps, and has an activation fallback.
- Live Phase 1 run: UNVERIFIED for sleeping. Real run `find a bed and sleep` connected as `SleepAudit` and correctly returned `not_sleep_time`; no night/bed setup was claimed. Ten consecutive live passes and respawn verification remain UNVERIFIED.
- Evidence: `TaskPlanner` selected `Survival:find_and_sleep`; the skill returned `not_sleep_time`; the task ended `failed` after the existing identical retry path. The retry-contract defect is reserved for Phase 3/b.
