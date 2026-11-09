# Capability matrix

Status is based on repository evidence and automated tests, not on function names or README claims.

| Specification sections | Status | Evidence / gap |
|---|---|---|
| 1 Audit and architecture | COMPLETE AND TESTED | Repository audit completed; this matrix is the baseline. |
| 2 New-player progression | PARTIALLY IMPLEMENTED | Planner has basic wood/stone/food/build flows; no gated progression state machine. |
| 3 Player awareness | PARTIALLY IMPLEMENTED | Survival snapshots exist; unified `PlayerStateController` added, not yet wired to every agent. |
| 4 Movement/control | PARTIALLY IMPLEMENTED | Pathfinder, follow/goto/stop and several skills exist; no complete transport/portal/stuck contract. |
| 5 Exploration | PARTIALLY IMPLEMENTED | Scan/find skills exist; no persistent explored-region/world knowledge model. |
| 6 Resources | PARTIALLY IMPLEMENTED | Wood/stone/ore skills exist; no complete version-aware resource requirement ledger. |
| 7 Mining | PARTIALLY IMPLEMENTED | Ore/vein/strip skills exist; no proven route-resume/full integration. |
| 8 Crafting/smelting | PARTIALLY IMPLEMENTED | Recipe-backed Mineflayer crafting exists; broad recipe/equipment coverage is unverified. |
| 9 Food/farming | PARTIALLY IMPLEMENTED | Food/crop/hunt/cook skills exist; sustainable farm integration is unverified. |
| 10 Survival | PARTIALLY IMPLEMENTED | Monitoring, food, shelter and escape skills exist; `find_and_sleep` has explicit failure states but live night/bed verification is UNVERIFIED. |
| 11 Inventory/storage | PARTIALLY IMPLEMENTED | Inventory/chest skills exist; no shared reservation ledger. |
| 12 Building | PARTIALLY IMPLEMENTED | Blueprint-like structures exist; custom blueprint generation and full verification are incomplete. |
| 13 Combat | IMPLEMENTED BUT UNVERIFIED | Attack/defense skills exist; no live-world combat evidence. |
| 14 Villages/trading | NOT IMPLEMENTED | No dedicated villager/trading controller or registered trade skills found. |
| 15 Enchanting | PARTIALLY IMPLEMENTED | Mineflayer-backed option inspection and verified enchanting skill exist; live progression unverified. |
| 16 Redstone | PARTIALLY IMPLEMENTED | Component inspection, activation, and verified lamp-switch blueprint exist; complex circuits unimplemented. |
| 17 Transportation/dimensions | PARTIALLY IMPLEMENTED | Verified portal transition and boat/minecart movement skills exist; live travel coverage is limited. |
| 18 Player interaction | PARTIALLY IMPLEMENTED | Dispatcher covers common commands; command coverage differs from requested list. |
| 19 Ten agents | IMPLEMENTED BUT UNVERIFIED | Exactly 10 registry entries and unit tests; no independent agent runtime/coordination proof. |
| 20 Natural language | PARTIALLY IMPLEMENTED | Deterministic phrase planner and cognitive-loop model seam; no full structured tool-call planner. |
| 21 Autonomy | PARTIALLY IMPLEMENTED | Opt-in idle scheduler, survival loop, and safety gates exist; broad autonomous progression remains incomplete. |
| 22 Learning/memory | PARTIALLY IMPLEMENTED | Typed verified experiences, world sessions, observations, actions, stats, and lessons persist; researcher evaluation remains limited. |
| 23 Telegram | IMPLEMENTED BUT UNVERIFIED | Long-polling and authorization exist; network/live Telegram tests are absent. |
| 24 Providers/Hermes/HF | PARTIALLY IMPLEMENTED | OpenRouter, Ollama, and Hugging Face adapters with persisted latency/token telemetry; Hermes absent. |
| 25 Skill registry | COMPLETE AND TESTED | Registry metadata/dependency/resource checks pass; broad live skill coverage remains limited. |
| 26 World/resource management | PARTIALLY IMPLEMENTED | Persistent world sessions, observations, reservations, actions, goals, and resource checks exist. |
| 27 Safety/reliability | PARTIALLY IMPLEMENTED | Mutex, timeouts, retries, cancellation, emergency stop, reconnect supervisor, and restart recovery exist; long-run recovery unverified. |
| 28 Compatibility | PARTIALLY IMPLEMENTED | Installed minecraft-data supports `26.1`, while `.env` requests `26.1.2`; compatibility decision remains open. |
| 29 Testing | PARTIALLY IMPLEMENTED | `npm test`: 68 passed, 1 skipped; scenario harness added but setup channel is unconfigured and live sleep is UNVERIFIED. |
| 30 Delivery docs/dashboard | PARTIALLY IMPLEMENTED | README, audit/checklist, and local dashboard API exist; no full web UI. |
| 31 Execution rules | PARTIALLY IMPLEMENTED | Tests and persistence exist; major categories remain absent. |
| 32 Acceptance scenario | NOT VERIFIED | Live smoke completed; clean-world acceptance correctly rejected non-empty inventory and needs a prepared Survival world. |

## Current verification boundary

`npm.cmd test` passes 68 tests with one intentionally skipped MySQL integration test. Live wood collection passed once after the Phase 2 repair; Phase 1 sleep was not verified because the live run was daytime and no setup command channel is configured.
