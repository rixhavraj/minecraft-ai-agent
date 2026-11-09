# Parker Shamblin repository integration audit

Source reviewed: `parkershamblin/minecraft-ai-agents` public README and repository architecture references on 2026-11-09.

## Findings

The repository uses a Node 22 Mineflayer minecraft-service as the single world executor, a Python/FastAPI LangGraph agent loop, a Python pgvector memory service, an event-service ledger, and a benchmark/dashboard layer. Its most reusable ideas for this project are the typed skill contract, strict provider seam, stale-command/watchdog handling, survival reflexes below LLM deliberation, provenance-aware reflection, and honest benchmark gates. Its Kafka/Redpanda, Postgres/pgvector, Java services, and dashboard are intentionally out of scope for this 16 GB laptop architecture.

The public README reports 27 typed skills/primitives, live demo gates, and benchmark methodology, but those claims are upstream project claims; they are not evidence that this local project has those components. Live Minecraft proof remains environment-dependent.

## Selective integration status

| Component | Decision | Local result |
|---|---|---|
| Single Mineflayer executor | Keep | Existing `SkillExecutor` remains authoritative. |
| Typed/versioned skill metadata | Integrate | Registry now records semantic `version`. |
| Preconditions | Integrate | Optional registry `precondition` hook added. |
| Watchdog/timeouts | Strengthen | Existing timeout retained; cancellation signal support added. |
| Failure taxonomy | Integrate | Results classify precondition, verification, timeout, resource, navigation, cancellation, and execution failures. |
| Skill mastery statistics | Integrate | Executor exposes attempts, successes, failures, duration, and success rate. |
| Survival reflexes | Adapt later | Existing survival controller is the integration point; no second combat/task loop created. |
| LangGraph loop | Adapt conceptually | Keep current Node task planner; add perception/retrieval/reflection stages incrementally. |
| Event ledger | Adapt to SQLite | Existing task events and observations are retained; no Kafka introduced. |
| pgvector memory | Defer | SQLite is appropriate for the current laptop target. |
| Benchmark harness | Next | Add reproducible local run records before comparing providers. |

## License and attribution

No source files were copied from the upstream repository in this stage. The implementation changes are independent adaptations of publicly described architectural ideas. Before copying code, inspect the upstream license and preserve required notices; do not treat README descriptions as a license grant.

## Verification boundary

The local project currently has 48 passing tests and one skipped MySQL integration test. A non-destructive live smoke task has completed successfully. The clean Survival-world acceptance harness still requires a prepared empty-inventory world and records measured task/event metrics without fabricating results.
