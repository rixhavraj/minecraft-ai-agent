# Known Limitations

- Phase 1 parallel infrastructure is implemented and unit tested, but live continuous-monitoring behavior has not been verified in Minecraft.
- Monitors publish recommendations/events only; the central task executor remains the sole action controller.
- Reward calculation, strategy comparison, policy promotion, and Python reinforcement learning are not implemented.
- The current planner is deterministic and supports the existing skill vocabulary; it is not a general Minecraft planner.
- SQLite remains authoritative despite optional MySQL connectivity.
- Live coordinate navigation previously timed out at `(-230, 60, -330)`; no arrival was claimed.
