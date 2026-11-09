import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyWorldState, SharedWorldState } from '../src/intelligence/sharedState.js'
import { IntelligenceEventBus } from '../src/intelligence/parallel/eventBus.js'
import { ParallelOrchestrator } from '../src/intelligence/parallel/parallelOrchestrator.js'
import { WorldStateMonitor } from '../src/intelligence/parallel/monitors.js'
test('event bus publishes traceable typed events',()=>{const bus=new IntelligenceEventBus();let seen;bus.on('HEALTH_CRITICAL',e=>{seen=e});const event=bus.publish('HEALTH_CRITICAL',{priority:0,payload:{health:4},worldStateVersion:3});assert.equal(seen.eventId,event.eventId);assert.equal(seen.worldStateVersion,3)})
test('parallel monitors observe concurrently without controlling Minecraft',async()=>{const state=new SharedWorldState(emptyWorldState());state.update({player:{health:4}});const bus=new IntelligenceEventBus();const events=[];bus.on('HEALTH_CRITICAL',e=>events.push(e));bus.on('WORLD_STATE_UPDATED',e=>events.push(e));const orchestrator=new ParallelOrchestrator({worldState:state,eventBus:bus,monitors:[new WorldStateMonitor({worldState:state,eventBus:bus}),{name:'slow-read-only',observe:async()=>{await new Promise(r=>setTimeout(r,5));return {}}}]});orchestrator.observations.running=true;await orchestrator.observations.tick();orchestrator.stop();assert.ok(events.some(e=>e.type==='HEALTH_CRITICAL'));assert.ok(events.some(e=>e.type==='WORLD_STATE_UPDATED'))})
