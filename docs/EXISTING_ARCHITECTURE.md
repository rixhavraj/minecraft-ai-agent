# Existing Architecture

## Authoritative components

- `src/index.js`: lifecycle, singleton production bot, wiring, shutdown.
- `src/integrations/telegram.js`: authenticated long polling and notifications.
- `src/integrations/minecraft_supervisor.js`: Mineflayer connection/reconnect ownership.
- `src/integrations/command_dispatcher.js`: slash commands, local queries, and natural-language entry point.
- `src/nlp/`: validated interpretation boundary.
- `src/tasks/task_executor.js`: priority queue, lifecycle, cancellation, pause/resume, and skill execution lock.
- `src/tasks/task_planner.js`: deterministic command-to-skill decomposition.
- `src/skills/registry.js` and `src/skills/executor.js`: validated action registry and execution boundary.
- `src/database/memory_store.js`: SQLite persistence and task/event/memory telemetry.
- `src/state/`: Mineflayer-derived player/entity/threat observations.

## Design decision

The Phase 1 foundation exposes shared state and orchestration contracts around these components. It does not create new Minecraft connections or give specialist agents direct action access.
