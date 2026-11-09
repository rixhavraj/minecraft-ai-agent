# Implementation audit

This audit reflects the current repository state and the latest master prompt. It deliberately distinguishes registered functions from verified gameplay.

## Architecture currently present

- One Mineflayer connection per configured bot definition; the intended production setup uses one character.
- One shared `TaskExecutor` and one `SkillExecutor` with per-bot mutexes, retries, timeouts, cancellation, verification, resource reservations, and failure classes.
- Ten current registry entries: Commander, Strategist, Explorer, Miner, Builder, Survival, Crafter, Combat, Memory, Researcher.
- SQLite task/memory persistence, world observations, blueprints, resource reservations, and task events.
- Telegram long polling with owner/group authorization.
- Deterministic phrase-based task planner, cognitive loop, and OpenRouter/Ollama/Hugging Face provider seam.
- Player state observation and opt-in autonomous idle scheduler.

## Exact-role status

The latest prompt requires exactly: Commander, Strategist, Survival, Explorer, Miner, Crafter, Builder, Combat, Researcher, Memory.

The registry contains exactly the ten roles required by the latest prompt. Food/farming skills route to Survival and inventory/storage responsibility routes to Memory.

## Capability status

| Area | Current evidence | Status |
|---|---|---|
| One authoritative executor | `src/skills/executor.js`, task executor tests | Complete at unit level; live long-run unverified |
| Ten logical agents | Registry test confirms exact required ten roles | Complete at unit level; live coordination unverified |
| Gameplay skill registry | Metadata, dependency validation, 100+ imported skills | Implemented; broad live verification absent |
| Movement/gathering/mining/crafting | Mineflayer skills and dependency-aware planner | Partially implemented; live acceptance incomplete |
| Food/farming/breeding | Registered skills, verified breeding added | Partially implemented |
| Building/storage/combat | Existing skills and verification hooks | Partially implemented |
| Villagers/trading | Inspect and verified trade execution skills | Implemented but live unverified |
| Enchanting | Inspect and verified enchant skills | Implemented but live unverified |
| Redstone | Inspect, activate, and lamp-switch blueprint | Partially implemented |
| Portals/dimensions | Inspect and verified transition skill | Implemented but live unverified |
| Nether/stronghold/End/dragon | Readiness, fortress, blaze, loaded portal, and dimension-transition checks | Partially implemented; no complete dragon controller |
| Cognitive loop | Perception, verified retrieval, planning, central execution, terminal reflection | Partially implemented; broad autonomous deliberation unverified |
| Memory types | Typed experiences, observations, world sessions, reservations, actions, goals, stats, and lessons | Implemented at persistence/API level; long-run learning quality unverified |
| Model providers | OpenRouter, Ollama, and Hugging Face adapters with persisted latency/token telemetry; Hermes not implemented | Partially implemented |
| Dashboard | Local API exposes bot, tasks, agents, skills, memory, actions, goals, benchmarks, and provider calls | Implemented; UI/live long-run unverified |
| Benchmarking | `BenchmarkRunner` executes central tasks and persists measured terminal status/duration | Partially implemented; reproducible world reset absent |
| Acceptance scenario | Live smoke completed; guarded acceptance rejected non-empty inventory | Not verified until prepared clean world is supplied |

## Integration decision

Do not replace the current Node.js architecture with the external harness wholesale. Preserve the single task/action executors and SQLite footprint. Adapt its useful contracts—explicit lifecycle, stale/cancelled actions, observations versus assumptions, watchdogs, and benchmark receipts—inside this project. Any source copied from external repositories requires license inspection and attribution first.

## Next implementation order

1. Migrate the registry to the exact ten requested logical roles without deleting gameplay skills.
2. Add typed memory categories and verified reflection records.
3. Add the explicit perception → retrieval → planning → execution → verification → reflection cycle.
4. Add provider adapters and usage accounting.
5. Add Nether/stronghold/End progression gates.
6. Add benchmark receipts and live-world acceptance tooling.
