const blocks = ['oak log','birch log','stone','cobblestone','iron ore','coal ore','dirt','sand','glass','planks','crafting table','furnace','chest','bed','wood','iron','diamond']
const entities = ['zombie','skeleton','spider','creeper','villager','cow','pig','sheep','chicken','player']
export function extractEntities(text) {
  const lower = text.toLowerCase(); const found = [...blocks, ...entities].filter(x => lower.includes(x))
  const quantities = {}
  for (const m of lower.matchAll(/\b(\d+)\s+(?:stacks?\s+of\s+)?([a-z][a-z _-]+)/g)) quantities[m[2].trim().replaceAll(' ','_')] = Number(m[1])
  for (const m of lower.matchAll(/\b(?:another|collect|get|gather|mine)\s+(\d+)\b/g)) quantities.amount = Number(m[1])
  const location = lower.match(/\b(?:near|beside|by|at|inside|outside)\s+(?:the\s+)?([a-z _-]+?)(?=\s+(?:and|but|before|after|if|unless|while)\b|[.,]|$)/i)?.[1]?.trim() ?? null
  return { entities: [...new Set(found)], quantities, location: location ? { relation: 'relative', target: location } : null }
}
