export class ContextResolver {
  constructor({ conversationMemory, memories = [] } = {}) { this.conversationMemory = conversationMemory; this.memories = memories }
  resolve(text) { const prior = this.conversationMemory?.recent?.() ?? []; const last = prior.at(-1)?.instruction ?? ''; const follow = /\b(?:it|that|there|another|continue|make it bigger|beside the house)\b/i.test(text); return { text: follow && last ? `${text} (context: ${last})` : text, references: follow ? [last] : [] } }
}
