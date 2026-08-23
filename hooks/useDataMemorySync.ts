import { useCallback, useEffect, useRef, useState } from 'react';
import type { InvoiceActionLog, InvoicePrintLog, SavedInvoice, UserProfile } from '../types';
import type { InventoryItem, WholesaleList } from './usePOS';
import {
  archiveMonthId,
  buildArchivePayload,
  collectedArchivedIds,
  filterSince,
  localHistoryCutoff,
  partitionInvoiceHistory,
  readArchiveCatalog,
  trimInvoiceHistoryLocal,
  upsertArchivePackMeta,
  type InvoiceArchivePayload,
} from '../utils/dataRetention';
import {
  isTelegramDbConnected,
  telegramFetchArchiveDocument,
  telegramSaveSnapshot,
  telegramSendArchiveDocument,
} from '../utils/telegramDb';

const ARCHIVE_DEBOUNCE_MS = 2500;
const RECENT_SNAPSHOT_DEBOUNCE_MS = 1800;

export interface DataMemorySyncApi {
  /** Push due (>30d) history to Telegram, then trim local. */
  archiveNow: () => Promise<{ ok: true; packs: number; removed: number } | { ok: false; error: string }>;
  /** Pull a Telegram archive pack into local history (for viewing older invoices). */
  restoreArchive: (
    packId: string
  ) => Promise<{ ok: true; logs: number; prints: number } | { ok: false; error: string }>;
  listArchives: () => ReturnType<typeof readArchiveCatalog>['packs'];
  status: string | null;
  busy: boolean;
}

interface ShopSettingsSnapshot {
  themeMode?: string;
  businessName?: string;
  businessPhone?: string;
  businessAddress?: string;
  currency?: string;
  profiles?: UserProfile[];
  activeProfileId?: string;
  accountPlan?: string;
  [key: string]: unknown;
}

interface Options {
  accountId: string | null;
  authReady: boolean;
  pastLogs: InvoiceActionLog[];
  printLogs: InvoicePrintLog[];
  inventory: InventoryItem[];
  /** Theme, business info, profiles — Telegram shop snapshot (not auth). */
  settings: ShopSettingsSnapshot;
  wholesales?: WholesaleList[];
  activeWholesaleId?: string;
  getSavedInvoices?: () => SavedInvoice[];
  replaceInvoiceHistory: (next: {
    pastLogs: InvoiceActionLog[];
    printLogs: InvoicePrintLog[];
  }) => void;
}

/**
 * Telegram = long-term shop memory (inventory, invoices, logs, settings, profiles).
 * Device = 30d working history for time-series logs only.
 * Supabase auth / access codes are NEVER trimmed here.
 */
export const useDataMemorySync = ({
  accountId,
  authReady,
  pastLogs,
  printLogs,
  inventory,
  settings,
  wholesales = [],
  activeWholesaleId = '',
  getSavedInvoices,
  replaceInvoiceHistory,
}: Options): DataMemorySyncApi => {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const archiveTimer = useRef<number | null>(null);
  const recentTimer = useRef<number | null>(null);
  const pastRef = useRef(pastLogs);
  const printRef = useRef(printLogs);
  const inventoryRef = useRef(inventory);
  const settingsRef = useRef(settings);
  const wholesalesRef = useRef(wholesales);
  const activeWholesaleRef = useRef(activeWholesaleId);
  const getSavedInvoicesRef = useRef(getSavedInvoices);
  pastRef.current = pastLogs;
  printRef.current = printLogs;
  inventoryRef.current = inventory;
  settingsRef.current = settings;
  wholesalesRef.current = wholesales;
  activeWholesaleRef.current = activeWholesaleId;
  getSavedInvoicesRef.current = getSavedInvoices;

  const runArchivePass = useCallback(async (): Promise<
    { ok: true; packs: number; removed: number } | { ok: false; error: string }
  > => {
    if (!accountId) return { ok: false, error: 'Not signed in.' };
    if (!isTelegramDbConnected(accountId)) {
      return { ok: false, error: 'Connect Telegram first (long-term memory).' };
    }

    const cutoff = localHistoryCutoff();
    const dueLogs = partitionInvoiceHistory(pastRef.current, cutoff).due;
    const duePrints = partitionInvoiceHistory(printRef.current, cutoff).due;
    if (dueLogs.length === 0 && duePrints.length === 0) {
      // Still trim anything already marked archived
      const ids = collectedArchivedIds(accountId);
      const trimmed = trimInvoiceHistoryLocal(
        pastRef.current,
        printRef.current,
        ids.logIds,
        ids.printIds,
        cutoff
      );
      if (trimmed.removed > 0) {
        replaceInvoiceHistory({
          pastLogs: trimmed.pastLogs,
          printLogs: trimmed.printLogs,
        });
      }
      return { ok: true, packs: 0, removed: trimmed.removed };
    }

    // Group due rows by calendar month
    const byMonth = new Map<string, { logs: InvoiceActionLog[]; prints: InvoicePrintLog[] }>();
    for (const log of dueLogs) {
      const key = archiveMonthId(log.timestamp);
      const bucket = byMonth.get(key) ?? { logs: [], prints: [] };
      bucket.logs.push(log);
      byMonth.set(key, bucket);
    }
    for (const print of duePrints) {
      const key = archiveMonthId(print.timestamp);
      const bucket = byMonth.get(key) ?? { logs: [], prints: [] };
      bucket.prints.push(print);
      byMonth.set(key, bucket);
    }

    let packs = 0;
    for (const [monthId, bucket] of byMonth) {
      const payload = buildArchivePayload(bucket.logs, bucket.prints);
      if (!payload) continue;

      // Chunk oversized months by splitting logs/prints roughly in half until send works
      const chunks: InvoiceArchivePayload[] = [payload];
      const sentMeta: Array<{
        id: string;
        fileId: string;
        payload: InvoiceArchivePayload;
      }> = [];

      while (chunks.length > 0) {
        const chunk = chunks.shift()!;
        const archiveId = `${monthId}_${chunk.from}-${chunk.to}`;
        const sent = await telegramSendArchiveDocument(accountId, archiveId, chunk);
        if (sent.ok === false) {
          // Try split if payload likely too large for upload edge cases
          if (chunk.logs.length + chunk.prints.length > 8) {
            const midLog = Math.ceil(chunk.logs.length / 2);
            const midPrint = Math.ceil(chunk.prints.length / 2);
            const left = buildArchivePayload(
              chunk.logs.slice(0, midLog),
              chunk.prints.slice(0, midPrint)
            );
            const right = buildArchivePayload(
              chunk.logs.slice(midLog),
              chunk.prints.slice(midPrint)
            );
            if (left) chunks.push(left);
            if (right) chunks.push(right);
            continue;
          }
          return { ok: false, error: sent.error };
        }
        sentMeta.push({ id: archiveId, fileId: sent.fileId, payload: chunk });
        packs += 1;
      }

      for (const meta of sentMeta) {
        upsertArchivePackMeta(accountId, {
          id: meta.id,
          fileId: meta.fileId,
          from: meta.payload.from,
          to: meta.payload.to,
          archivedAt: Date.now(),
          logCount: meta.payload.logs.length,
          printCount: meta.payload.prints.length,
          logIds: meta.payload.logs.map((l) => l.id),
          printIds: meta.payload.prints.map((p) => p.id),
        });
      }
    }

    const ids = collectedArchivedIds(accountId);
    const trimmed = trimInvoiceHistoryLocal(
      pastRef.current,
      printRef.current,
      ids.logIds,
      ids.printIds,
      cutoff
    );
    replaceInvoiceHistory({
      pastLogs: trimmed.pastLogs,
      printLogs: trimmed.printLogs,
    });

    return { ok: true, packs, removed: trimmed.removed };
  }, [accountId, replaceInvoiceHistory]);

  const archiveNow = useCallback(async () => {
    setBusy(true);
    setStatus('Archiving older history to Telegram…');
    try {
      const result = await runArchivePass();
      if (result.ok === false) {
        setStatus(result.error);
        return result;
      }
      setStatus(
        result.packs === 0 && result.removed === 0
          ? 'Nothing older than 30 days to archive.'
          : `Archived ${result.packs} pack(s), removed ${result.removed} local row(s).`
      );
      return result;
    } finally {
      setBusy(false);
    }
  }, [runArchivePass]);

  const restoreArchive = useCallback(
    async (packId: string) => {
      if (!accountId) return { ok: false as const, error: 'Not signed in.' };
      const pack = readArchiveCatalog(accountId).packs.find((p) => p.id === packId);
      if (!pack) return { ok: false as const, error: 'Archive pack not found.' };

      setBusy(true);
      setStatus('Restoring from Telegram…');
      try {
        const fetched = await telegramFetchArchiveDocument<InvoiceArchivePayload>(
          accountId,
          pack.fileId
        );
        if (fetched.ok === false) {
          setStatus(fetched.error);
          return fetched;
        }
        const payload = fetched.row.payload;
        if (!payload || !Array.isArray(payload.logs) || !Array.isArray(payload.prints)) {
          const err = 'Archive payload missing logs/prints.';
          setStatus(err);
          return { ok: false as const, error: err };
        }

        const pastById = new Map(pastRef.current.map((l) => [l.id, l]));
        for (const l of payload.logs) pastById.set(l.id, l);
        const printById = new Map(printRef.current.map((p) => [p.id, p]));
        for (const p of payload.prints) printById.set(p.id, p);

        replaceInvoiceHistory({
          pastLogs: [...pastById.values()].sort((a, b) => a.timestamp - b.timestamp),
          printLogs: [...printById.values()].sort((a, b) => a.timestamp - b.timestamp),
        });
        setStatus(`Restored ${payload.logs.length} log(s), ${payload.prints.length} print(s).`);
        return {
          ok: true as const,
          logs: payload.logs.length,
          prints: payload.prints.length,
        };
      } finally {
        setBusy(false);
      }
    },
    [accountId, replaceInvoiceHistory]
  );

  const listArchives = useCallback(() => {
    if (!accountId) return [];
    return [...readArchiveCatalog(accountId).packs].sort((a, b) => b.to - a.to);
  }, [accountId]);

  // Debounced Telegram shop snapshots (current-state + recent 30d history)
  useEffect(() => {
    if (!authReady || !accountId || !isTelegramDbConnected(accountId)) return;

    if (recentTimer.current) window.clearTimeout(recentTimer.current);
    recentTimer.current = window.setTimeout(() => {
      const cutoff = localHistoryCutoff();
      const s = settingsRef.current;
      const profiles = Array.isArray(s.profiles) ? s.profiles : [];

      void telegramSaveSnapshot(accountId, 'inventory', inventoryRef.current).catch((e) =>
        console.warn('[iCalc memory] inventory snapshot failed', e)
      );

      void telegramSaveSnapshot(accountId, 'settings', {
        themeMode: s.themeMode,
        businessName: s.businessName,
        businessPhone: s.businessPhone,
        businessAddress: s.businessAddress,
        currency: s.currency,
        accountPlan: s.accountPlan,
        activeProfileId: s.activeProfileId,
        savedAt: Date.now(),
      }).catch((e) => console.warn('[iCalc memory] settings snapshot failed', e));

      void telegramSaveSnapshot(accountId, 'profiles', {
        profiles,
        activeProfileId: s.activeProfileId ?? '',
        savedAt: Date.now(),
      }).catch((e) => console.warn('[iCalc memory] profiles snapshot failed', e));

      void telegramSaveSnapshot(accountId, 'wholesales', {
        lists: wholesalesRef.current,
        activeWholesaleId: activeWholesaleRef.current,
        savedAt: Date.now(),
      }).catch((e) => console.warn('[iCalc memory] wholesales snapshot failed', e));

      void telegramSaveSnapshot(accountId, 'invoice_recent', {
        pastLogs: filterSince(pastRef.current, cutoff),
        printLogs: filterSince(printRef.current, cutoff),
        savedInvoices: getSavedInvoicesRef.current?.() ?? [],
        savedAt: Date.now(),
      }).catch((e) => console.warn('[iCalc memory] invoice_recent snapshot failed', e));
    }, RECENT_SNAPSHOT_DEBOUNCE_MS);

    return () => {
      if (recentTimer.current) window.clearTimeout(recentTimer.current);
    };
  }, [authReady, accountId, pastLogs, printLogs, inventory, settings, wholesales, activeWholesaleId]);

  // Debounced archive pass when history grows / ages
  useEffect(() => {
    if (!authReady || !accountId || !isTelegramDbConnected(accountId)) return;

    if (archiveTimer.current) window.clearTimeout(archiveTimer.current);
    archiveTimer.current = window.setTimeout(() => {
      void runArchivePass().catch((e) =>
        console.warn('[iCalc memory] archive pass failed', e)
      );
    }, ARCHIVE_DEBOUNCE_MS);

    return () => {
      if (archiveTimer.current) window.clearTimeout(archiveTimer.current);
    };
  }, [authReady, accountId, pastLogs, printLogs, runArchivePass]);

  // On open: trim only local invoice HISTORY older than 30d (after Telegram archive ack).
  // Never touches Supabase auth, access codes, or sessions.
  useEffect(() => {
    if (!authReady || !accountId) return;
    const ids = collectedArchivedIds(accountId);
    const trimmed = trimInvoiceHistoryLocal(
      pastRef.current,
      printRef.current,
      ids.logIds,
      ids.printIds
    );
    if (trimmed.removed > 0) {
      replaceInvoiceHistory({
        pastLogs: trimmed.pastLogs,
        printLogs: trimmed.printLogs,
      });
    }
  }, [authReady, accountId, replaceInvoiceHistory]);

  return {
    archiveNow,
    restoreArchive,
    listArchives,
    status,
    busy,
  };
};
