function bindByCode(chatId, tgUser, code) {
  const payload = {
    code,
    telegramId: String(chatId),
    username: tgUser?.username || '',
    firstName: tgUser?.first_name || '',
  };
  return reqJson('POST', api('/api/2fa/bot_bind'), payload);
}

function markQueue(id, status, errorText) {
  return reqJson('POST', api('/api/2fa/bot_mark'), {
    id,
    status,
    errorText: errorText || null,
  });
}

function setSession(sessionId, action) {
  return reqJson('POST', api('/api/2fa/bot_session'), {
    sessionId,
    action,
  });
}

async function pollQueue() {
  if (pollingBusy) return;
  pollingBusy = true;
  try {
    const data = await reqJson('GET', api('/api/2fa/bot_pull?limit=10'), null);
    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) {
      if (!item || !item.id) continue;
      await processQueueItem(item);
    }
  } catch (e) {
  } finally {
    pollingBusy = false;
  }
}
