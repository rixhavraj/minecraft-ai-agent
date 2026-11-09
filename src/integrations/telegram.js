import { logger } from '../utils/logger.js';

export function isAuthorizedTelegramMessage(message, config) {
  const isOwner = String(message.from?.id) === String(config.ownerId);
  const isAllowedChat = !config.groupId
    || String(message.chat?.id) === String(config.groupId)
    || message.chat?.type === 'private';
  return isOwner && isAllowedChat;
}

export function createTelegramController(config, handleCommand) {
  let offset = 0;
  let stopped = false;
  let pollDelayMs = 3000;
  let lastAuthorizedChatId = null;
  const api = (method, body) => fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(async (r) => { const data = await r.json(); if (!r.ok || !data.ok) throw new Error(data.description ?? `Telegram ${r.status}`); return data.result; });
  const send = (chatId, text) => api('sendMessage', { chat_id: chatId, text });
  async function waitForExclusivePolling() {
    try { await api('deleteWebhook', { drop_pending_updates: false }); } catch (error) { logger.warn({ err: error }, 'Could not clear Telegram webhook'); }
  }
  async function poll() {
    while (!stopped) {
      try {
        const updates = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
        pollDelayMs = 3000;
        for (const update of updates) {
          offset = update.update_id + 1;
          const message = update.message;
          if (!message?.text) continue;
          if (!isAuthorizedTelegramMessage(message, config)) continue;
          lastAuthorizedChatId = message.chat?.id ?? lastAuthorizedChatId;
          const reply = await handleCommand(message.text, { chatId: message.chat.id, sender: message.from?.id });
          if (reply) await send(message.chat.id, reply);
        }
      } catch (error) {
        logger.warn({ err: error, retryInMs: pollDelayMs }, 'Telegram polling unavailable; Minecraft control remains active')
        await new Promise((resolve) => setTimeout(resolve, pollDelayMs))
        pollDelayMs = Math.min(pollDelayMs * 2, 60_000)
      }
    }
  }
  void waitForExclusivePolling().then(poll);
  return {
    notify: async (text) => {
      const targetChatId = config.groupId || lastAuthorizedChatId;
      if (!targetChatId) return false;
      try {
        await send(targetChatId, text);
        return true;
      } catch (error) {
        if (targetChatId !== lastAuthorizedChatId && lastAuthorizedChatId) {
          try {
            await send(lastAuthorizedChatId, text);
            return true;
          } catch (fallbackError) {
            logger.warn({ err: fallbackError, primaryError: error }, 'Could not deliver Telegram update to configured or active chat');
          }
        } else {
          logger.warn({ err: error }, 'Could not deliver Telegram survival update');
        }
        return false;
      }
    },
    stop: () => { stopped = true; },
  };
}
