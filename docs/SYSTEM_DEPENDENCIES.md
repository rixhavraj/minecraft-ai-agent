# System Dependencies

- Node.js 24.19.0 and npm 11.17.0 observed in the development environment.
- Mineflayer 4.39.0 and mineflayer-pathfinder 2.4.5 are installed.
- SQLite remains the authoritative synchronous persistence layer for the current runtime. MySQL is optional integration only; the requested migration is not complete.
- Zod 4.6.7 validates NLU and shared world state.
- Live Minecraft compatibility depends on the configured server protocol; one live navigation smoke connected successfully but timed out, so protocol compatibility and path reachability must be tested separately.
- No Python/RL dependencies are installed or introduced. Reinforcement learning is intentionally deferred until verified JavaScript observations, actions, rewards, and evaluation are stable.
