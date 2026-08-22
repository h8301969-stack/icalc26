/**
 * Per-account Telegram Bot API storage.
 * Bot token lives only in device storage (never committed, never synced to Supabase).
 * Supabase remains for auth + admin portal access codes only.
 */

import { Capacitor } from '@capacitor/core';
import { storage } from '../hooks/storage';

export interface TelegramDbConfig {
  botToken: string;
  /** Private chat / channel where JSON rows are stored */
  chatId: string;
  botUsername?: string;
  connectedAt: number;
}

export interface TelegramDbRow<T = unknown> {
  v: 1;
  kind: string;
  id: string;
  user_id: string;
  payload: T;
  updated_at: string;
  /** Telegram message_id when known */
  message_id?: number;
}

const configKey = (accountId: string) => `icalc_telegram_db_${accountId}`;
const indexKey = (accountId: string) => `icalc_telegram_db_index_${accountId}`;
/** Shared device link for Skip (dev) + admin portal testing (same bot/chat). */
const SHARED_CONFIG_KEY = 'icalc_telegram_db_shared_dev';

type EntityIndex = Record<string, number>; // `${kind}:${id}` → message_id

/** BotFather tokens look like `123456789:AA…` */
export const looksLikeBotToken = (token: string): boolean =>
  /^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token.trim());

export const getSharedTelegramDbConfig = (): TelegramDbConfig | null => {
  const raw = storage.get<TelegramDbConfig | null>(SHARED_CONFIG_KEY, null);
  if (!raw?.botToken || !raw.chatId) return null;
  return raw;
};

export const setSharedTelegramDbConfig = (config: TelegramDbConfig): void => {
  storage.set(SHARED_CONFIG_KEY, config);
};

export const getTelegramDbConfig = (accountId: string): TelegramDbConfig | null => {
  if (!accountId) return getSharedTelegramDbConfig();
  const raw = storage.get<TelegramDbConfig | null>(configKey(accountId), null);
  if (raw?.botToken && raw?.chatId) return raw;
  // Reuse shared testing bot for Skip/dev + admin sessions.
  const shared = getSharedTelegramDbConfig();
  if (shared) {
    storage.set(configKey(accountId), shared);
    return shared;
  }
  return null;
};

export const isTelegramDbConnected = (accountId: string | null | undefined): boolean => {
  if (accountId && getTelegramDbConfig(accountId)) return true;
  return !!getSharedTelegramDbConfig();
};

export const setTelegramDbConfig = (accountId: string, config: TelegramDbConfig): void => {
  storage.set(configKey(accountId), config);
  // Always mirror for Skip (dev) / admin portal so both reuse the same bot.
  setSharedTelegramDbConfig(config);
};

export const clearTelegramDbConfig = (accountId: string): void => {
  storage.set(configKey(accountId), null);
  storage.set(indexKey(accountId), {});
  // Do not clear SHARED_CONFIG_KEY — Skip/dev and admin keep the testing bot.
};

const getIndex = (accountId: string): EntityIndex =>
  storage.get<EntityIndex>(indexKey(accountId), {});

const setIndex = (accountId: string, index: EntityIndex): void => {
  storage.set(indexKey(accountId), index);
};

const apiBase = (token: string) => `https://api.telegram.org/bot${token.trim()}`;

async function telegramCall<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>
): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${apiBase(token)}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const data = (await res.json()) as { ok?: boolean; result?: T; description?: string };
    if (!data.ok) {
      return { ok: false, error: data.description || `Telegram ${method} failed` };
    }
    return { ok: true, result: data.result as T };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error';
    // Browsers block api.telegram.org via CORS; Capacitor native does not.
    if (!Capacitor.isNativePlatform() && /Failed to fetch|NetworkError|CORS/i.test(message)) {
      return {
        ok: false,
        error:
          'Telegram Bot API is blocked in the browser. Use the Android app, or add a tiny proxy worker later.',
      };
    }
    return { ok: false, error: message };
  }
}

export async function verifyTelegramBotToken(
  token: string
): Promise<{ ok: true; username: string } | { ok: false; error: string }> {
  if (!looksLikeBotToken(token)) {
    return { ok: false, error: 'Bot token should look like 123456:ABC… from BotFather.' };
  }
  const result = await telegramCall<{ username?: string; first_name?: string }>(token, 'getMe');
  if (result.ok === false) return result;
  return {
    ok: true,
    username: result.result.username ? `@${result.result.username}` : result.result.first_name || 'bot',
  };
}

/**
 * Resolve a storage chat id: prefer explicit chatId, else first private chat from getUpdates.
 * Admin must message /start to their bot once so getUpdates can see the chat.
 */
export async function resolveTelegramStorageChat(
  token: string,
  explicitChatId?: string
): Promise<{ ok: true; chatId: string } | { ok: false; error: string }> {
  const trimmed = explicitChatId?.trim();
  if (trimmed) {
    const probe = await telegramCall(token, 'getChat', { chat_id: trimmed });
    if (probe.ok === false) return probe;
    return { ok: true, chatId: trimmed };
  }

  const updates = await telegramCall<
    Array<{ message?: { chat?: { id?: number; type?: string } } }>
  >(token, 'getUpdates', { limit: 50, timeout: 0 });
  if (updates.ok === false) return updates;

  for (let i = updates.result.length - 1; i >= 0; i -= 1) {
    const chat = updates.result[i]?.message?.chat;
    if (chat?.id != null && (chat.type === 'private' || chat.type === 'group' || chat.type === 'supergroup' || chat.type === 'channel')) {
      return { ok: true, chatId: String(chat.id) };
    }
  }

  return {
    ok: false,
    error:
      'No chat found. Open Telegram, message /start to your bot once, then try again — or paste a chat id.',
  };
}

export async function connectTelegramDatabase(input: {
  accountId: string;
  botToken: string;
  chatId?: string;
}): Promise<{ ok: true; config: TelegramDbConfig } | { ok: false; error: string }> {
  const verified = await verifyTelegramBotToken(input.botToken);
  if (verified.ok === false) return verified;

  const chat = await resolveTelegramStorageChat(input.botToken, input.chatId);
  if (chat.ok === false) return chat;

  const config: TelegramDbConfig = {
    botToken: input.botToken.trim(),
    chatId: chat.chatId,
    botUsername: verified.username,
    connectedAt: Date.now(),
  };
  setTelegramDbConfig(input.accountId, config);

  // Seed an index marker message so the chat is clearly the app DB.
  await telegramCall(config.botToken, 'sendMessage', {
    chat_id: config.chatId,
    text: JSON.stringify(
      {
        v: 1,
        kind: 'icalc_db_meta',
        user_id: input.accountId,
        payload: { connected: true, bot: config.botUsername },
        updated_at: new Date().toISOString(),
      },
      null,
      0
    ),
    disable_notification: true,
  });

  return { ok: true, config };
}

export async function telegramUpsertEntity<T>(
  accountId: string,
  kind: string,
  id: string,
  payload: T
): Promise<{ ok: true; messageId: number } | { ok: false; error: string }> {
  const config = getTelegramDbConfig(accountId);
  if (!config) return { ok: false, error: 'Telegram database is not connected.' };

  const row: TelegramDbRow<T> = {
    v: 1,
    kind,
    id,
    user_id: accountId,
    payload,
    updated_at: new Date().toISOString(),
  };
  const text = JSON.stringify(row);
  if (text.length > 4000) {
    return { ok: false, error: 'Row too large for a Telegram message (max ~4096 chars).' };
  }

  const key = `${kind}:${id}`;
  const index = getIndex(accountId);
  const existingId = index[key];

  if (existingId) {
    const edited = await telegramCall<{ message_id: number }>(config.botToken, 'editMessageText', {
      chat_id: config.chatId,
      message_id: existingId,
      text,
    });
    if (edited.ok) {
      return { ok: true, messageId: existingId };
    }
    // Fall through to send if message was deleted.
  }

  const sent = await telegramCall<{ message_id: number }>(config.botToken, 'sendMessage', {
    chat_id: config.chatId,
    text,
    disable_notification: true,
  });
  if (sent.ok === false) return sent;

  index[key] = sent.result.message_id;
  setIndex(accountId, index);
  return { ok: true, messageId: sent.result.message_id };
}

/** Persist a full JSON collection as one message (settings / inventory snapshot). */
export async function telegramSaveSnapshot(
  accountId: string,
  snapshotKind: string,
  data: unknown
): Promise<{ ok: true } | { ok: false; error: string }> {
  return telegramUpsertEntity(accountId, 'snapshot', snapshotKind, data).then((r) =>
    r.ok ? { ok: true as const } : r
  );
}

const canvasToPngBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png', 1));

/**
 * Send an invoice image to the linked Telegram bot chat (sendPhoto).
 * Uses account config, or the shared Skip/dev testing bot.
 */
export async function sendInvoiceImageToTelegram(input: {
  accountId?: string | null;
  canvas: HTMLCanvasElement;
  caption: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const config =
    (input.accountId ? getTelegramDbConfig(input.accountId) : null) ?? getSharedTelegramDbConfig();
  if (!config) {
    return { ok: false, error: 'Telegram bot not linked. Connect Bot API once on Skip (dev).' };
  }

  const blob = await canvasToPngBlob(input.canvas);
  if (!blob) return { ok: false, error: 'Could not encode invoice image.' };

  try {
    const form = new FormData();
    form.append('chat_id', config.chatId);
    form.append('caption', input.caption.slice(0, 1024));
    form.append('photo', blob, `invoice-${Date.now()}.png`);

    const res = await fetch(`${apiBase(config.botToken)}/sendPhoto`, {
      method: 'POST',
      body: form,
    });
    const data = (await res.json()) as { ok?: boolean; description?: string };
    if (!data.ok) {
      return { ok: false, error: data.description || 'Telegram sendPhoto failed' };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error';
    if (!Capacitor.isNativePlatform() && /Failed to fetch|NetworkError|CORS/i.test(message)) {
      return {
        ok: false,
        error:
          'Browser blocked Telegram upload (CORS). Use the Android build, or deploy the telegram-bot Edge Function proxy.',
      };
    }
    return { ok: false, error: message };
  }
}
