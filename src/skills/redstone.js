import { skillRegistry } from './registry.js'

const COMPONENTS = [
  'lever', 'stone_button', 'polished_blackstone_button', 'oak_button',
  'stone_pressure_plate', 'oak_pressure_plate', 'redstone_torch',
  'redstone_wire', 'repeater', 'comparator', 'piston', 'sticky_piston',
  'observer', 'dispenser', 'dropper', 'hopper', 'redstone_lamp',
]

skillRegistry.register({
  id: 'inspect_redstone_components',
  name: 'Inspect Redstone Components',
  category: 'world_management',
  description: 'Scan nearby loaded blocks for redstone components and return observed coordinates',
  arguments: { radius: { type: 'number', required: false, default: 16 } },
  timeout: 15000,
  async execute(bot, args, context) {
    const radius = Math.min(args.radius ?? 16, 64)
    const components = []
    for (const name of COMPONENTS) {
      const definition = context.mcData.blocksByName[name]
      if (!definition) continue
      const positions = bot.findBlocks({ matching: definition.id, maxDistance: radius, count: 32 })
      components.push(...positions.map((position) => ({ name, position: { x: position.x, y: position.y, z: position.z }, stateId: bot.blockAt(position)?.stateId ?? null })))
    }
    return { success: true, radius, components }
  },
})

skillRegistry.register({
  id: 'build_redstone_lamp_switch',
  name: 'Build Redstone Lamp Switch',
  category: 'building',
  description: 'Build a compact lever, wire, and redstone lamp circuit through the shared blueprint engine',
  arguments: { originX: { type: 'number', required: false }, originY: { type: 'number', required: false }, originZ: { type: 'number', required: false } },
  timeout: 120000,
  async execute(bot, args, context) {
    const origin = {
      x: args.originX ?? Math.floor(bot.entity.position.x) + 2,
      y: args.originY ?? Math.floor(bot.entity.position.y),
      z: args.originZ ?? Math.floor(bot.entity.position.z),
    }
    const blueprint = {
      name: 'redstone_lamp_switch',
      origin,
      layers: [
        { y: 0, blocks: [
          { x: 0, z: 0, block: 'stone' },
          { x: 1, z: 0, block: 'redstone_wire' },
          { x: 2, z: 0, block: 'redstone_lamp' },
        ] },
        { y: 1, blocks: [{ x: 0, z: 0, block: 'lever' }] },
      ],
    }
    const builder = skillRegistry.get('build_structure')
    if (!builder) return { success: false, error: 'Shared building skill is unavailable' }
    const result = await builder.execute(bot, { blueprint }, context)
    if (!result.success) return { success: false, error: 'Redstone blueprint placement failed', result }
    const placed = blueprint.layers.flatMap((layer) => layer.blocks.map((block) => bot.blockAt({ x: origin.x + block.x, y: origin.y + layer.y, z: origin.z + block.z })?.name))
    const verified = placed.filter(Boolean).length === 4
    return { success: verified, blueprint: blueprint.name, origin, placed, verified, error: verified ? undefined : 'Not all circuit blocks were observed after placement' }
  },
})

skillRegistry.register({
  id: 'activate_redstone_component',
  name: 'Activate Redstone Component',
  category: 'world_management',
  description: 'Activate a nearby lever/button/plate and verify its block state changed',
  arguments: { component: { type: 'string', required: false, default: 'lever' }, radius: { type: 'number', required: false, default: 6 } },
  timeout: 15000,
  async execute(bot, args, context) {
    const name = args.component ?? 'lever'
    if (!['lever', 'stone_button', 'polished_blackstone_button', 'oak_button', 'stone_pressure_plate', 'oak_pressure_plate'].includes(name)) {
      return { success: false, error: `Component '${name}' is not safely activatable` }
    }
    const definition = context.mcData.blocksByName[name]
    if (!definition) return { success: false, error: `Component '${name}' is unavailable in this Minecraft version` }
    const position = bot.findBlock({ matching: definition.id, maxDistance: Math.min(args.radius ?? 6, 16) })
    if (!position) return { success: false, error: `No ${name} found within range` }
    const before = bot.blockAt(position)?.stateId ?? null
    await bot.activateBlock(bot.blockAt(position))
    await new Promise((resolve) => setTimeout(resolve, 400))
    const after = bot.blockAt(position)?.stateId ?? null
    if (before === after) return { success: false, error: `Activated ${name}, but no block-state change was observed`, position: { x: position.x, y: position.y, z: position.z }, before, after }
    return { success: true, component: name, position: { x: position.x, y: position.y, z: position.z }, before, after }
  },
})
