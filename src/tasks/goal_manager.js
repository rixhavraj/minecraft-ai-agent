import { memoryStore } from '../database/memory_store.js'

export class GoalManager {
  create(input) { return memoryStore.createGoal(input) }
  update(id, patch) { memoryStore.updateGoal(id, patch); return memoryStore.getGoals().find((goal) => goal.id === id) ?? null }
  active() { return memoryStore.getGoals('active') }
  all() { return memoryStore.getGoals() }
}

export const goalManager = new GoalManager()
