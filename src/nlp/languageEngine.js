import { askModelWithFallback } from '../integrations/providers.js'
import { logger } from '../utils/logger.js'
import { memoryStore } from '../database/memory_store.js'
import { classifyIntents } from './intentClassifier.js'
import { decompose } from './objectiveDecomposer.js'
import { detectAmbiguity } from './ambiguityResolver.js'
import { buildTaskGraph } from '../planning/taskGraphBuilder.js'
import { resolveDependencies } from '../planning/dependencyResolver.js'
import { validateInstruction } from './instructionValidator.js'
import { ContextResolver } from './contextResolver.js'
import { ConversationMemory } from '../memory/conversationMemory.js'
import { TaskMemory } from '../memory/taskMemory.js'
import { ExperienceMemory } from '../memory/experienceMemory.js'
const log=logger.child({component:'LanguageEngine'})
export class LanguageEngine {
  constructor({ model = null, conversationMemory = new ConversationMemory(), taskMemory = new TaskMemory(memoryStore), experienceMemory = new ExperienceMemory(memoryStore), logger: customLogger = log } = {}) { this.model=model; this.conversationMemory=conversationMemory; this.taskMemory=taskMemory; this.experienceMemory=experienceMemory; this.context=new ContextResolver({conversationMemory}); this.log=customLogger }
  async interpret(originalInstruction, { providerCandidates = [], allowModel = true } = {}) {
    const original=String(originalInstruction).trim(); if(!original) throw new Error('Instruction must not be empty')
    const resolved=this.context.resolve(original); const intents=classifyIntents(resolved.text); let objectives=decompose(resolved.text,intents)
    // A provider may improve interpretation, but it is advisory: deterministic safety and schema validation remain authoritative.
    if (allowModel && this.model) { const candidate=await this.model({ instruction:resolved.text }); if(Array.isArray(candidate?.objectives)) objectives=objectiveMerge(objectives,candidate.objectives) }
    else if (allowModel && providerCandidates.length) { try { await askModelWithFallback({providers:providerCandidates,prompt:`Return JSON only with objectives for this Minecraft instruction. Instruction: ${resolved.text}`,maxTokens:600}) } catch (error) { this.log.warn({err:error.message},'Advisory NLU model unavailable; using deterministic parser') } }
    const ambiguity=detectAmbiguity(resolved.text,objectives); const graph=resolveDependencies(buildTaskGraph(objectives));
    const plan={message_type:'instruction',intent:intents,original_instruction:original,summary:objectives.map(o=>o.description).join('; '),objectives,global_conditions:objectives.flatMap(o=>o.conditions),global_restrictions:[...new Set(objectives.flatMap(o=>o.restrictions))],clarification_required:ambiguity.clarificationRequired,clarification_question:ambiguity.question,execution_plan:graph.order.map(id=>({objective_id:id})),memory_references:[...this.taskMemory.relevant(original),...this.experienceMemory.relevant(original)].map(x=>x.id??x),confidence:ambiguity.clarificationRequired?.62:.88}
    const validated=validateInstruction(plan); this.conversationMemory.add(original,validated); this.log.info({original_instruction:original,intent:intents,objective_count:validated.objectives.length,clarification_required:validated.clarification_required,confidence:validated.confidence},'Instruction understood'); return validated
  }
}
function objectiveMerge(base,candidate) { return base.map((o,i)=>({...o,...candidate[i],id:o.id,dependencies:o.dependencies,restrictions:[...new Set([...(o.restrictions??[]),...(candidate[i]?.restrictions??[])])]})) }
export const languageEngine=new LanguageEngine()
