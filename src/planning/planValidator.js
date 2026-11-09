import { instructionSchema } from '../nlp/schemas/instruction.schema.js'
export function validatePlan(plan) { const result=instructionSchema.safeParse(plan); if(!result.success) throw new Error(`Invalid NLU plan: ${result.error.message}`); if(plan.execution_plan.some(s=>s.executeAction)) throw new Error('NLU plans cannot execute Minecraft actions'); return result.data }
