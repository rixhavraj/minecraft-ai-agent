export class ObservationCoordinator {
  constructor({ worldState, eventBus, intervalMs = 1000, monitors = [] } = {}) { this.worldState=worldState; this.eventBus=eventBus; this.intervalMs=intervalMs; this.monitors=monitors; this.timer=null; this.running=false; this.version=0 }
  addMonitor(monitor) { this.monitors.push(monitor); return monitor }
  async tick() {
    if (!this.running) return
    const snapshot=this.worldState.snapshot(); const results=await Promise.allSettled(this.monitors.map(m=>m.observe?.(snapshot)))
    for(const [index,result] of results.entries()) if(result.status==='rejected') this.eventBus.publish('MONITOR_FAILED',{priority:2,payload:{monitor:this.monitors[index].name??'unknown',error:result.reason?.message??String(result.reason)}})
    this.version+=1; this.eventBus.publish('WORLD_STATE_UPDATED',{worldStateVersion:this.version,payload:this.worldState.snapshot()})
  }
  start() { if(this.running)return; this.running=true; void this.tick(); this.timer=setInterval(()=>void this.tick(),this.intervalMs); this.timer.unref?.() }
  stop() { if(this.timer)clearInterval(this.timer); this.timer=null; this.running=false }
}
