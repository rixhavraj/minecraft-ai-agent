import { logger } from '../utils/logger.js'
import { memoryStore } from '../database/memory_store.js'

const log = logger.child({ component: 'ModelProviders' })

async function requestJson(url, options, { timeoutMs = 30000, retries = 2 } = {}) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { ...options, signal: controller.signal })
      const body = await response.json()
      if (!response.ok) throw new Error(`${response.status}: ${body.error?.message ?? body.error ?? 'provider request failed'}`)
      return body
    } catch (error) {
      lastError = error
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError
}

export async function askModel({ provider = 'openrouter', apiKey, model, prompt, baseUrl, timeoutMs = 30000, maxTokens = 128 }) {
  const startedAt = Date.now()
  const record = (status, usage = null, error = null) => memoryStore.recordModelCall({ provider, model, status, latencyMs: Date.now() - startedAt, usage, error })
  try {
  const messages = [
    { role: 'system', content: 'You are Commander, the Minecraft AI squad coordinator. Do not claim physical actions occurred without verified game state.' },
    { role: 'user', content: prompt },
  ]
  let body
  if (provider === 'google') {
    body = await requestJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: messages[0].content }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens, temperature: 0.5 } }),
    }, { timeoutMs })
    const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? ''
    record('completed', body.usageMetadata ?? null)
    return { text: text.trim(), provider, model, usage: body.usageMetadata ?? null }
  }
  if (provider === 'ollama') {
    body = await requestJson(`${(baseUrl ?? 'http://localhost:11434').replace(/\/$/, '')}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false, options: { temperature: 0.5 } }),
    }, { timeoutMs })
    const usage = body.prompt_eval_count != null ? { inputTokens: body.prompt_eval_count, outputTokens: body.eval_count ?? 0 } : null
    record('completed', usage)
    return { text: body.message?.content?.trim() ?? '', provider, model, usage }
  }
  if (provider === 'huggingface') {
    body = await requestJson(`https://api-inference.huggingface.co/models/${model}`, {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: maxTokens, return_full_text: false } }),
    }, { timeoutMs })
    const text = Array.isArray(body) ? body[0]?.generated_text : body.generated_text
    record('completed')
    return { text: text?.trim() ?? '', provider, model, usage: null }
  }
  const endpoint = provider === 'groq'
    ? 'https://api.groq.com/openai/v1/chat/completions'
    : 'https://openrouter.ai/api/v1/chat/completions'
  body = await requestJson(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(provider === 'openrouter' ? { 'HTTP-Referer': 'http://localhost', 'X-Title': 'Minecraft AI Squad' } : {}) },
    body: JSON.stringify({ model, messages, temperature: 0.5, max_tokens: maxTokens }),
  }, { timeoutMs })
  log.debug({ provider, model }, 'Model request completed')
  record('completed', body.usage ?? null)
  return { text: body.choices?.[0]?.message?.content?.trim() ?? '', provider, model, usage: body.usage ?? null }
  } catch (error) {
    record('failed', null, error.message)
    throw error
  }
}

export async function askModelWithFallback({ providers, prompt, timeoutMs = 30000, maxTokens = 128 }) {
  const failures = []
  for (const candidate of providers) {
    if (!candidate?.apiKey && candidate.provider !== 'ollama') continue
    try { return await askModel({ ...candidate, prompt, timeoutMs, maxTokens }) } catch (error) { failures.push(`${candidate.provider}: ${error.message}`); log.warn({ provider: candidate.provider, err: error.message }, 'Model provider failed; trying fallback') }
  }
  throw new Error(`All configured model providers failed: ${failures.join(' | ') || 'none configured'}`)
}
