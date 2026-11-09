import test from 'node:test'
import assert from 'node:assert/strict'
import { SharedWorldState, emptyWorldState } from '../src/intelligence/sharedState.js'
import { IntelligenceOrchestrator } from '../src/intelligence/orchestrator.js'
test('shared world state validates patches and emits snapshots',()=>{ const state=new SharedWorldState(emptyWorldState()); let seen; state.subscribe(value=>{seen=value}); state.update({player:{health:18},threats:{detected:true,level:'medium'}}); assert.equal(seen.player.health,18); assert.equal(seen.threats.level,'medium'); assert.ok(seen.timestamp) })
test('orchestrator schedules only through the central executor',async()=>{ const calls=[]; const orchestrator=new IntelligenceOrchestrator({language:{interpret:async text=>({original_instruction:text,clarification_required:false})},executor:{submitCommand:async(...args)=>{calls.push(args); return {id:'t1'}}}}); const r=await orchestrator.interpretAndSchedule('collect wood'); assert.equal(r.status,'scheduled'); assert.equal(calls.length,1); assert.equal(calls[0][0],'collect wood') })
