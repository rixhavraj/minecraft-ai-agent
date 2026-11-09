import { z } from 'zod'

export const worldStateSchema = z.object({
  player: z.object({ username: z.string().nullable(), health: z.number().nullable(), food: z.number().nullable(), position: z.any().nullable(), dimension: z.string().nullable(), biome: z.string().nullable(), equipment: z.record(z.string(), z.any()), inventory: z.array(z.any()) }),
  environment: z.object({ nearbyBlocks: z.array(z.any()), nearbyEntities: z.array(z.any()), resources: z.array(z.any()), structures: z.array(z.any()), containers: z.array(z.any()), beds: z.array(z.any()) }),
  conditions: z.object({ isDay: z.boolean().nullable(), isNight: z.boolean().nullable(), isRaining: z.boolean().nullable() }),
  threats: z.object({ detected: z.boolean(), level: z.enum(['none','low','medium','high','critical']), entities: z.array(z.any()), nearestThreat: z.any().nullable() }),
  safety: z.object({ safe: z.boolean(), currentRisk: z.enum(['low','medium','high','critical']), recommendedAction: z.string() }),
  timestamp: z.string().nullable(),
})

export function emptyWorldState() { return worldStateSchema.parse({ player:{username:null,health:null,food:null,position:null,dimension:null,biome:null,equipment:{},inventory:[]}, environment:{nearbyBlocks:[],nearbyEntities:[],resources:[],structures:[],containers:[],beds:[]}, conditions:{isDay:null,isNight:null,isRaining:null}, threats:{detected:false,level:'none',entities:[],nearestThreat:null}, safety:{safe:true,currentRisk:'low',recommendedAction:'continue'}, timestamp:null }) }

export class SharedWorldState {
  constructor(initial = emptyWorldState()) { this.state = worldStateSchema.parse(initial); this.listeners = new Set() }
  snapshot() { return structuredClone(this.state) }
  update(patch) { this.state = worldStateSchema.parse(deepMerge(this.state, patch)); this.state.timestamp = new Date().toISOString(); for (const listener of this.listeners) listener(this.snapshot()); return this.snapshot() }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
}
function deepMerge(a,b) { const out={...a}; for(const [k,v] of Object.entries(b??{})) out[k]=v&&typeof v==='object'&&!Array.isArray(v)&&a[k]&&typeof a[k]==='object'&&!Array.isArray(a[k])?deepMerge(a[k],v):v; return out }
