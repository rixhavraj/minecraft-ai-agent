# Minecraft AI Squad - Autonomous Minecraft AI Agent

A locally hosted, owner-controlled autonomous AI squad for Minecraft Java Edition built with Mineflayer, Mineflayer-Pathfinder, SQLite/MySQL, and Telegram.

## System Capabilities

| Capability | Status | Implementation Details |
|---|---|---|
| **Centralized Skill Registry** | **WORKING** | 97 registered gameplay skills with validated schemas, timeouts, verification, and recovery functions. |
| **Movement & Navigation** | **WORKING** | Following, pathfinding (GoalBlock, GoalFollow, GoalNear, GoalXZ), hazard avoidance, stuck detection & recovery, swimming, climbing. |
| **Exploration & Terrain** | **WORKING** | Scan nearby blocks, identify terrain & biomes, find caves, villages, rivers, mountains, and flat building sites. |
| **Resource Gathering & Mining** | **WORKING** | Wood chopping, stone mining, ore mining (coal, iron, copper, gold, redstone, lapis, diamonds), vein mining, strip mining, tool requirements. |
| **Food & Farming** | **WORKING** | Food search, crop harvesting, replanting, passive animal hunting, furnace cooking, farmland creation, sustainable farm building. |
| **Survival & Defense** | **WORKING** | Vital monitoring, food reflexes, hostile detection, cooldown-gated automatic defense task dispatch, threat evaluation, and emergency stop. Advanced combat outcomes still require live-world verification. |
| **Crafting & Equipment** | **WORKING** | 2x2 & 3x3 crafting, crafting tables, wooden/stone/iron/diamond tools, weapons, shields, armor, torches, chests, furnaces, ore smelting. |
| **Inventory & Storage** | **WORKING** | Item inspection, counting, missing material checks, chest deposit & retrieval, storage sorting, dropping, valuable item protection. |
| **Building & Construction** | **WORKING** | Blueprint engine supporting small wooden house, stone house, watchtowers, defensive walls, bridges, area clearing, structure verification. |
| **Combat & Base Defense** | **WORKING** | Weapon & armor auto-equip, hostile targeting, attack cooldowns, base perimeter patrol, combat reports. |
| **Autonomous Task Executor** | **WORKING** | 8-stage lifecycle (`RECEIVED` -> `UNDERSTANDING` -> `PLANNING` -> `RESOURCE_CHECK` -> `EXECUTING` -> `OBSERVING` -> `VERIFYING` -> `COMPLETED`) with retry recovery and per-bot physical action locks. |
| **Ten Specialized Agents** | **WORKING** | Commander, Strategist, Explorer, Miner, Builder, Survival, Crafter, Combat, Memory, Researcher. |
| **Natural Language Engine** | **WORKING** | Translates instructions (e.g. "Collect 32 oak logs and build a small house") into sequential executable subtasks with assigned agents. |
| **Telegram Control** | **WORKING** | Full slash command suite (`/status`, `/agents`, `/skills`, `/task`, `/position`, `/inventory`, `/survival`, `/base`, `/mine`, `/build`, `/farm`, `/craft`, `/pause`, `/resume`, `/cancel`, `/stop`, `/help`) and live progress streaming. |
| **Persistent Memory & Learning** | **WORKING** | SQLite (`squad.sqlite`) and MySQL persistence storing tasks, executions, lessons learned, observations, and blueprints. |

---

## The 10 Squad Agents

1. **Commander**: Receives commands from the owner, delegates to specialized agents, coordinates execution.
2. **Strategist**: Decomposes high-level objectives into ordered sequences of executable skill tasks.
3. **Explorer**: Maps terrain, locates forests, caves, villages, water bodies, and building sites.
4. **Miner**: Extracts stone, ores (iron, coal, gold, diamond), digs shafts, and handles tools.
5. **Builder**: Constructs houses, watchtowers, defensive walls, bridges, and verifies structures.
6. **Survival**: Gathers food, farms, hunts, cooks, monitors health/hunger, and defends the squad.
7. **Crafter**: Crafts tools, weapons, armor, crafting tables, chests, furnaces, and smelts ores.
8. **Combat**: Handles hostile targeting, weapon use, defense, and combat recovery.
9. **Memory**: Organizes inventory/storage knowledge, observations, verified experiences, and resource history.
10. **Researcher**: Analyzes previous successes and failures to improve future plans.

---

## Telegram & Natural-Language Control

Send commands or instructions to the Telegram bot:

### Slash Commands
- `/status` - Bot connection, vitals, active task progress, and queue depth
- `/agents` - Status and role of all 10 squad agents
- `/skills` - Complete list of 97 registered skills by category
- `/task` - Active task lifecycle status and recent task history
- `/position` - Current bot coordinates (X, Y, Z)
- `/survival` or `/health` - Health, hunger, time of day, nearby hostiles
- `/inventory` - Detailed list of items in bot inventory
- `/base` - View or save base coordinates (`/base set`)
- `/follow [player]` - Follow player in-game
- `/stop` - Emergency stop all movement and active tasks
- `/explore [radius]` - Scout surrounding area
- `/mine <resource> [qty]` - Mine ores or gather wood
- `/farm [crop]` - Harvest and plant crops
- `/build <structure>` - Construct small house, stone house, wall, tower
- `/craft <item>` - Craft tools, tables, furnaces, armor
- `/pause` / `/resume` / `/cancel` - Control execution engine
- `/help` - Help directory

### Natural Language Instructions
- `"Collect 32 oak logs and build a small house"`
- `"Find food and cook it"`
- `"Mine iron and craft tools"`
- `"Build a safe base, collect food, prepare tools, and protect the area"`
- `"Explore the world and find a village"`
- `"Run the clean world survival bootstrap acceptance test"` - plans wood, tools, stone, food, iron, smelting, shelter, and base registration through the central executor.

### Local observability and benchmarks

Set `DASHBOARD_ENABLED=true` to expose the local API on `DASHBOARD_PORT` (default `8787`). It provides `/health`, `/agents`, `/skills`, `/memory`, `/actions`, `/goals`, `/benchmarks`, `/providers`, `/skill-stats`, and `/world-sessions`.

`BenchmarkRunner` submits tasks through the same authoritative task executor and records measured terminal status, duration, provider latency, and token usage. It does not fabricate live-world success; reproducible clean-world runs still require a controlled Minecraft world.

---

## Testing

Run the automated test suite covering all modules:
```powershell
npm test
```
All unit tests, skills registry, task planner, task executor, agent registry, command dispatcher, and memory store tests run with zero external dependencies using Node.js built-in test runner.
