import { EventEmitter } from 'node:events'
import { logger } from '../utils/logger.js'
import { SharedWorldState } from './sharedState.js'

export class IntelligenceOrchestrator extends EventEmitter {
  constructor({ language, perception = null, planner = null, executor, memory = null, learning = null, worldState = new SharedWorldState() } = {}) {
    super(); this.language=language; this.perception=perception; this.planner=planner; this.executor=executor; this.memory=memory; this.learning=learning; this.worldState=worldState; this.log=logger.child({component:'IntelligenceOrchestrator'}); this.unsubscribe=null
  }
  start() { this.unsubscribe=this.perception?.onUpdate?.((state)=>this.worldState.update(state)); this.log.info('Intelligence orchestrator started'); return this }
  stop() { this.unsubscribe?.(); this.unsubscribe=null; this.log.info('Intelligence orchestrator stopped') }
  async interpretAndSchedule(instruction, { priority=1, issuerName='Owner' } = {}) { if(!this.language||!this.executor) throw new Error('Orchestrator requires language and executor'); const parsed=await this.language.interpret(instruction); if(parsed.clarification_required) return { status:'clarification_required', parsed }; const task=await this.executor.submitCommand(parsed.original_instruction,priority,issuerName,{nlpPlan:parsed}); this.emit('scheduled',{task,parsed}); return {status:'scheduled',task,parsed} }
}
