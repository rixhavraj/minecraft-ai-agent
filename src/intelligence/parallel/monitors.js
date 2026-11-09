export class WorldStateMonitor {
  constructor({ worldState, eventBus }) { this.name='world-state'; this.worldState=worldState; this.eventBus=eventBus }
  observe() { const state=this.worldState.snapshot(); if(state.threats.level==='critical') this.eventBus.publish('THREAT_DETECTED',{priority:0,payload:state.threats}); if(state.player.health!=null&&state.player.health<=6)this.eventBus.publish('HEALTH_CRITICAL',{priority:0,payload:{health:state.player.health}}); if(state.player.food!=null&&state.player.food<=8)this.eventBus.publish('HUNGER_LOW',{priority:1,payload:{food:state.player.food}}) }
}

export class TaskStateMonitor {
  constructor({ taskExecutor, eventBus }) { this.name='task-state'; this.taskExecutor=taskExecutor; this.eventBus=eventBus }
  observe() { const task=this.taskExecutor?.activeTask; if(task?.id)this.eventBus.publish('TASK_PROGRESS_UPDATED',{priority:3,taskId:task.id,payload:{status:task.status,step:task.currentStepIndex}}) }
}
