import test from 'node:test';
import assert from 'node:assert/strict';
import { agentRegistry, AGENT_ROLES } from '../src/agents/agent_registry.js';
import { skillRegistry } from '../src/skills/registry.js';
import '../src/skills/index.js';

test('AgentRegistry contains all 10 specialized agents', () => {
  const agents = agentRegistry.listAgents();
  assert.equal(agents.length, 10);

  const expectedNames = [
    'Commander', 'Strategist', 'Explorer', 'Miner', 'Builder',
    'Survival', 'Crafter', 'Combat', 'Researcher', 'Memory',
  ];

  for (const name of expectedNames) {
    const found = agentRegistry.getAgent(name);
    assert.ok(found, `Agent ${name} must be registered`);
    assert.equal(found.name, name);
    assert.ok(found.role.length > 0);
  }
});

test('AgentRegistry resolves appropriate specialized agent for skill categories', () => {
  const woodSkill = skillRegistry.get('collect_wood');
  const woodAgent = agentRegistry.resolveAgentForSkill(woodSkill);
  assert.equal(woodAgent.name, 'Miner');

  const houseSkill = skillRegistry.get('build_small_house');
  const houseAgent = agentRegistry.resolveAgentForSkill(houseSkill);
  assert.equal(houseAgent.name, 'Builder');

  const farmSkill = skillRegistry.get('plant_crops');
  const farmAgent = agentRegistry.resolveAgentForSkill(farmSkill);
  assert.equal(farmAgent.name, 'Survival');

  const exploreSkill = skillRegistry.get('find_village');
  const exploreAgent = agentRegistry.resolveAgentForSkill(exploreSkill);
  assert.equal(exploreAgent.name, 'Explorer');
});

