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
/** One-time owner link for Skip (dev) + admin portal (prod + local). */
const OWNER_LINK_KEY = 'icalc_telegram_owner_link';
const OWNER_LINK_KEY_LEGACY = 'icalc_telegram_db_shared_dev';
/** Stable id used when binding the owner link before a real user session exists. */
export const OWNER_TELEGRAM_ACCOUNT_ID = 'icalc-owner-device';

type EntityIndex = Record<string, number>; // `${kind}:${id}` → message_id

/** BotFather tokens look like `123456789:AA…` */
export const looksLikeBotToken = (token: string): boolean =>
  /^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token.trim());

export const getSharedTelegramDbConfig = (): TelegramDbConfig | null => {
  const raw =
    storage.get<TelegramDbConfig | null>(OWNER_LINK_KEY, null) ??
    storage.get<TelegramDbConfig | null>(OWNER_LINK_KEY_LEGACY, null);
  if (!raw?.botToken || !raw.chatId) return null;
  // Migrate legacy key once.
  storage.set(OWNER_LINK_KEY, raw);
  return raw;
};

export const setSharedTelegramDbConfig = (config: TelegramDbConfig): void => {
  storage.set(OWNER_LINK_KEY, config);
  storage.set(OWNER_LINK_KEY_LEGACY, config);
};

export const hasOwnerTelegramLink = (): boolean => !!getSharedTelegramDbConfig();

/** Attach the saved owner bot/chat to any account (Skip/dev or admin Calc). */
export const bindAccountToOwnerTelegram = (accountId: string): TelegramDbConfig | null => {
  const shared = getSharedTelegramDbConfig();
  if (!shared || !accountId) return shared;
  storage.set(configKey(accountId), shared);
  return shared;
};

export const getTelegramDbConfig = (accountId: string): TelegramDbConfig | null => {
  if (!accountId) return getSharedTelegramDbConfig();
  const raw = storage.get<TelegramDbConfig | null>(configKey(accountId), null);
  if (raw?.botToken && raw?.chatId) return raw;
  return bindAccountToOwnerTelegram(accountId);
};

export const isTelegramDbConnected = (accountId: string | null | undefined): boolean => {
  if (hasOwnerTelegramLink()) return true;
  if (accountId && storage.get<TelegramDbConfig | null>(configKey(accountId), null)?.botToken) {
    return true;
  }
  return false;
};

export const setTelegramDbConfig = (
  accountId: string,
  config: TelegramDbConfig,
  opts?: { asOwnerLink?: boolean }
): void => {
  storage.set(configKey(accountId), config);
  if (opts?.asOwnerLink) setSharedTelegramDbConfig(config);
};

export const clearTelegramDbConfig = (accountId: string): void => {
  storage.set(configKey(accountId), null);
  storage.set(indexKey(accountId), {});
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

/**
 * Save shop bot/chat locally without re-verifying against Telegram network
 * (used when credentials were already stored by admin on approve).
 */
export const applyShopTelegramLocally = (
  accountId: string,
  botToken: string,
  chatId: string
): void => {
  if (!accountId || !botToken.trim() || !chatId.trim()) return;
  setTelegramDbConfig(accountId, {
    botToken: botToken.trim(),
    chatId: chatId.trim(),
    connectedAt: Date.now(),
  });
};

export async function connectTelegramDatabase(input: {
  accountId: string;
  botToken: string;
  chatId?: string;
  /** When true, also save as the one-time owner link (Skip/dev + admin portal). */
  asOwnerLink?: boolean;
}): Promise<{ ok: true; config: TelegramDbConfig } | { ok: false; error: string }> {
  const verified = await verifyTelegramBotToken(input.botToken);
  if (verified.ok === false) return verified;

  if (input.asOwnerLink && !input.chatId?.trim()) {
    return { ok: false, error: 'Chat ID is required.' };
  }

  const chat = await resolveTelegramStorageChat(input.botToken, input.chatId);
  if (chat.ok === false) return chat;

  const config: TelegramDbConfig = {
    botToken: input.botToken.trim(),
    chatId: chat.chatId,
    botUsername: verified.username,
    connectedAt: Date.now(),
  };
  setTelegramDbConfig(input.accountId, config, { asOwnerLink: !!input.asOwnerLink });

  // Seed an index marker message so the chat is clearly the app DB.
  await telegramCall(config.botToken, 'sendMessage', {
    chat_id: config.chatId,
    text: JSON.stringify(
      {
        v: 1,
        kind: 'icalc_db_meta',
        user_id: input.accountId,
        payload: { connected: true, bot: config.botUsername, owner: !!input.asOwnerLink },
        updated_at: new Date().toISOString(),
      },
      null,
      0
    ),
    disable_notification: true,
  });

  return { ok: true, config };
}

/** One-time (or Settings update) owner Bot API + chat ID for admin / Skip (dev). */
export async function connectOwnerTelegramLink(input: {
  botToken: string;
  chatId: string;
}): Promise<{ ok: true; config: TelegramDbConfig } | { ok: false; error: string }> {
  return connectTelegramDatabase({
    accountId: OWNER_TELEGRAM_ACCOUNT_ID,
    botToken: input.botToken,
    chatId: input.chatId.trim(),
    asOwnerLink: true,
  });
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

const corsHint = (message: string): string => {
  if (!Capacitor.isNativePlatform() && /Failed to fetch|NetworkError|CORS/i.test(message)) {
    return 'Browser blocked Telegram (CORS). Use the Android build, or deploy the telegram-bot Edge Function proxy.';
  }
  return message;
};

/**
 * Long-term archive: upload a JSON document so we can getFile() later
 * (Bot API cannot getMessage text by id).
 */
export async function telegramSendArchiveDocument(
  accountId: string,
  archiveId: string,
  payload: unknown
): Promise<{ ok: true; fileId: string; messageId: number } | { ok: false; error: string }> {
  const config = getTelegramDbConfig(accountId);
  if (!config) return { ok: false, error: 'Telegram database is not connected.' };

  const row: TelegramDbRow = {
    v: 1,
    kind: 'invoice_archive',
    id: archiveId,
    user_id: accountId,
    payload,
    updated_at: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(row)], { type: 'application/json' });

  try {
    const form = new FormData();
    form.append('chat_id', config.chatId);
    form.append('caption', `icalc archive ${archiveId}`.slice(0, 1024));
    form.append('document', blob, `icalc-archive-${archiveId}.json`);

    const res = await fetch(`${apiBase(config.botToken)}/sendDocument`, {
      method: 'POST',
      body: form,
    });
    const data = (await res.json()) as {
      ok?: boolean;
      description?: string;
      result?: {
        message_id?: number;
        document?: { file_id?: string };
      };
    };
    if (!data.ok || !data.result?.document?.file_id) {
      return { ok: false, error: data.description || 'Telegram sendDocument failed' };
    }

    const messageId = data.result.message_id ?? 0;
    const fileId = data.result.document.file_id;
    if (messageId) {
      const index = getIndex(accountId);
      index[`invoice_archive:${archiveId}`] = messageId;
      setIndex(accountId, index);
    }
    return { ok: true, fileId, messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error';
    return { ok: false, error: corsHint(message) };
  }
}

/** Download a previously archived JSON document by file_id. */
export async function telegramFetchArchiveDocument<T = unknown>(
  accountId: string,
  fileId: string
): Promise<{ ok: true; row: TelegramDbRow<T> } | { ok: false; error: string }> {
  const config = getTelegramDbConfig(accountId);
  if (!config) return { ok: false, error: 'Telegram database is not connected.' };

  try {
    const fileMeta = await telegramCall<{ file_path?: string }>(config.botToken, 'getFile', {
      file_id: fileId,
    });
    if (fileMeta.ok === false) return fileMeta;
    const path = fileMeta.result.file_path;
    if (!path) return { ok: false, error: 'Telegram file path missing.' };

    const fileRes = await fetch(`https://api.telegram.org/file/bot${config.botToken.trim()}/${path}`);
    if (!fileRes.ok) return { ok: false, error: `Download failed (${fileRes.status})` };
    const text = await fileRes.text();
    const parsed = JSON.parse(text) as TelegramDbRow<T>;
    if (!parsed || parsed.v !== 1) {
      return { ok: false, error: 'Archive file is not a valid iCalc row.' };
    }
    return { ok: true, row: parsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error';
    return { ok: false, error: corsHint(message) };
  }
}

const canvasToPngBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png', 1));

/**
 * Send an invoice image to the linked Telegram bot chat (sendPhoto).
 * Uses account config, or the shared Skip/dev testing bot.
 */
/** Plain text notify to the linked shop Telegram chat. */
export async function sendTelegramTextNotify(input: {
  accountId?: string | null;
  text: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const config =
    (input.accountId ? getTelegramDbConfig(input.accountId) : null) ?? getSharedTelegramDbConfig();
  if (!config) {
    return { ok: false, error: 'Telegram bot not linked. Set Bot API in the admin portal.' };
  }
  const sent = await telegramCall(config.botToken, 'sendMessage', {
    chat_id: config.chatId,
    text: input.text.slice(0, 4000),
    disable_web_page_preview: true,
  });
  if (sent.ok === false) return sent;
  return { ok: true };
}

/** Inventory item image refs stored as `tgfile:<file_id>` (bytes live on Telegram). */
export const TG_ITEM_IMAGE_PREFIX = 'tgfile:';

export const isTelegramItemImageRef = (value: string | null | undefined): boolean =>
  !!value && value.startsWith(TG_ITEM_IMAGE_PREFIX);

export const encodeTelegramItemImageRef = (fileId: string): string =>
  `${TG_ITEM_IMAGE_PREFIX}${fileId.trim()}`;

export const parseTelegramItemImageRef = (value: string | null | undefined): string | null => {
  if (!isTelegramItemImageRef(value)) return null;
  const id = value!.slice(TG_ITEM_IMAGE_PREFIX.length).trim();
  return id || null;
};

const itemImageUrlCache = new Map<string, string>();

const dataUrlToBlob = async (dataUrl: string): Promise<Blob | null> => {
  try {
    const res = await fetch(dataUrl);
    return await res.blob();
  } catch {
    return null;
  }
};

/** Upload an item photo to Telegram; returns a durable `tgfile:` ref for inventory. */
export async function telegramUploadItemImage(input: {
  accountId: string;
  itemId: string;
  /** data: URL or Blob */
  image: string | Blob;
  itemName?: string;
}): Promise<{ ok: true; imageRef: string; fileId: string } | { ok: false; error: string }> {
  const config = getTelegramDbConfig(input.accountId) ?? getSharedTelegramDbConfig();
  if (!config) {
    return { ok: false, error: 'Telegram bot not linked. Set Bot API in the admin portal.' };
  }

  const blob =
    typeof input.image === 'string' ? await dataUrlToBlob(input.image) : input.image;
  if (!blob) return { ok: false, error: 'Could not read item image.' };

  try {
    const form = new FormData();
    form.append('chat_id', config.chatId);
    form.append(
      'caption',
      `icalc item ${input.itemId}${input.itemName ? ` · ${input.itemName}` : ''}`.slice(0, 1024)
    );
    form.append('photo', blob, `item-${input.itemId}.jpg`);

    const res = await fetch(`${apiBase(config.botToken)}/sendPhoto`, {
      method: 'POST',
      body: form,
    });
    const data = (await res.json()) as {
      ok?: boolean;
      description?: string;
      result?: { photo?: Array<{ file_id?: string }> };
    };
    if (!data.ok) {
      return { ok: false, error: data.description || 'Telegram sendPhoto failed' };
    }
    const photos = data.result?.photo ?? [];
    const fileId = photos[photos.length - 1]?.file_id?.trim();
    if (!fileId) return { ok: false, error: 'Telegram did not return a file_id.' };

    // Prefer showing the just-uploaded bytes while we have them.
    if (typeof input.image === 'string' && input.image.startsWith('data:')) {
      itemImageUrlCache.set(fileId, input.image);
    } else {
      itemImageUrlCache.set(fileId, URL.createObjectURL(blob));
    }

    return { ok: true, imageRef: encodeTelegramItemImageRef(fileId), fileId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error';
    return { ok: false, error: corsHint(message) };
  }
}

/** Resolve a `tgfile:` inventory ref to a displayable URL (cached). */
export async function telegramResolveItemImageUrl(
  accountId: string | null | undefined,
  imageRef: string | null | undefined
): Promise<string | null> {
  const fileId = parseTelegramItemImageRef(imageRef);
  if (!fileId) return null;
  const cached = itemImageUrlCache.get(fileId);
  if (cached) return cached;

  const config =
    (accountId ? getTelegramDbConfig(accountId) : null) ?? getSharedTelegramDbConfig();
  if (!config) return null;

  try {
    const fileMeta = await telegramCall<{ file_path?: string }>(config.botToken, 'getFile', {
      file_id: fileId,
    });
    if (fileMeta.ok === false) return null;
    const path = fileMeta.result.file_path;
    if (!path) return null;

    const fileRes = await fetch(`https://api.telegram.org/file/bot${config.botToken.trim()}/${path}`);
    if (!fileRes.ok) return null;
    const blob = await fileRes.blob();
    const url = URL.createObjectURL(blob);
    itemImageUrlCache.set(fileId, url);
    return url;
  } catch {
    return null;
  }
}

export async function sendInvoiceImageToTelegram(input: {
  accountId?: string | null;
  canvas: HTMLCanvasElement;
  caption: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const config =
    (input.accountId ? getTelegramDbConfig(input.accountId) : null) ?? getSharedTelegramDbConfig();
  if (!config) {
    return { ok: false, error: 'Telegram bot not linked. Set Bot API in the admin portal.' };
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
