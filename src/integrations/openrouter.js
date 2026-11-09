import { logger } from '../utils/logger.js';

export async function askOpenRouter({ apiKey, model, prompt }) {
  if (!apiKey) return 'OpenRouter is not configured.';
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'Minecraft AI Squad',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are Commander, the Minecraft AI squad coordinator. Give concise, safe, actionable plans. Do not claim an action happened unless verified.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.5,
      max_tokens: 160,
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${body.error?.message ?? 'request failed'}`);
  logger.debug({ model }, 'OpenRouter request completed');
  return body.choices?.[0]?.message?.content?.trim() || 'No plan returned.';
}
