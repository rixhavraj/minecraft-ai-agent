import test from 'node:test'
import assert from 'node:assert/strict'
import { LanguageEngine } from '../src/nlp/languageEngine.js'
import { runNlpBenchmark } from '../src/evaluation/nlpBenchmark.js'
import { instructionFixtures } from '../src/evaluation/instructionFixtures.js'
test('NLU preserves original, restrictions, quantities and nested conditions', async()=>{ const p=await new LanguageEngine().interpret('Collect 32 oak logs, but if zombies appear, stop and return home. Do not enter caves.') ; assert.equal(p.original_instruction,'Collect 32 oak logs, but if zombies appear, stop and return home. Do not enter caves.'); assert.equal(p.objectives[0].quantities.oak_logs,32); assert.ok(p.global_restrictions.length); assert.ok(p.global_conditions.length); assert.ok(p.execution_plan.length) })
test('NLU benchmark has at least 100 fixtures and valid structured output',async()=>{ assert.ok(instructionFixtures.length>=100); const r=await runNlpBenchmark(); assert.equal(r.count,100); assert.equal(r.metrics.validity.accuracy,1); assert.ok(r.metrics.intent.accuracy>=.9); assert.ok(r.metrics.conditions.accuracy>=.9) })
