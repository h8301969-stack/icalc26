/**
 * Layered shop memory:
 * - Device: ~30 days of history (working set)
 * - Supabase: ~60 days (cloud buffer when signed in)
 * - Telegram: long-term archive (retrieve anytime)
 *
 * Current-state data (inventory, settings) is never age-trimmed.
 */

import type { InvoiceActionLog, InvoicePrintLog } from '../types';
import { storage } from '../hooks/storage';

export const LOCAL_HISTORY_MS = 30 * 24 * 60 * 60 * 1000;
export const SUPABASE_HISTORY_MS = 60 * 24 * 60 * 60 * 1000;

export interface InvoiceArchivePackMeta {
  id: string;
  /** Telegram file_id from sendDocument */
  fileId: string;
  from: number;
  to: number;
  archivedAt: number;
  logCount: number;
  printCount: number;
  logIds: string[];
  printIds: string[];
}

export interface InvoiceArchivePayload {
  from: number;
  to: number;
  logs: InvoiceActionLog[];
  prints: InvoicePrintLog[];
}

type ArchiveCatalog = {
  packs: InvoiceArchivePackMeta[];
};

const catalogKey = (accountId: string) => `icalc_memory_archives_${accountId}`;

export const readArchiveCatalog = (accountId: string): ArchiveCatalog =>
  storage.get<ArchiveCatalog>(catalogKey(accountId), { packs: [] });

export const writeArchiveCatalog = (accountId: string, catalog: ArchiveCatalog): void => {
  storage.set(catalogKey(accountId), {
    packs: catalog.packs.slice(-120),
  });
};

export const upsertArchivePackMeta = (
  accountId: string,
  meta: InvoiceArchivePackMeta
): void => {
  const catalog = readArchiveCatalog(accountId);
  const without = catalog.packs.filter((p) => p.id !== meta.id);
  writeArchiveCatalog(accountId, { packs: [...without, meta] });
};

export const localHistoryCutoff = (now = Date.now()): number => now - LOCAL_HISTORY_MS;

export const supabaseHistoryCutoff = (now = Date.now()): number => now - SUPABASE_HISTORY_MS;

export const partitionInvoiceHistory = <T extends { id: string; timestamp: number }>(
  rows: T[],
  cutoff: number
): { keep: T[]; due: T[] } => {
  const keep: T[] = [];
  const due: T[] = [];
  for (const row of rows) {
    if (row.timestamp >= cutoff) keep.push(row);
    else due.push(row);
  }
  return { keep, due };
};

export const filterSince = <T extends { timestamp: number }>(
  rows: T[],
  cutoff: number
): T[] => rows.filter((r) => r.timestamp >= cutoff);

/** Month key for archive packs, e.g. 2026-07 */
export const archiveMonthId = (timestamp: number): string => {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

export const buildArchivePayload = (
  logs: InvoiceActionLog[],
  prints: InvoicePrintLog[]
): InvoiceArchivePayload | null => {
  if (logs.length === 0 && prints.length === 0) return null;
  const stamps = [...logs.map((l) => l.timestamp), ...prints.map((p) => p.timestamp)];
  return {
    from: Math.min(...stamps),
    to: Math.max(...stamps),
    logs,
    prints,
  };
};

/** Drop rows older than cutoff only when they were successfully archived to Telegram. */
export const trimInvoiceHistoryLocal = (
  pastLogs: InvoiceActionLog[],
  printLogs: InvoicePrintLog[],
  archivedLogIds: Set<string>,
  archivedPrintIds: Set<string>,
  cutoff = localHistoryCutoff()
): { pastLogs: InvoiceActionLog[]; printLogs: InvoicePrintLog[]; removed: number } => {
  const trimmedPast = pastLogs.filter((l) => {
    if (l.timestamp >= cutoff) return true;
    return !archivedLogIds.has(l.id);
  });
  const trimmedPrint = printLogs.filter((p) => {
    if (p.timestamp >= cutoff) return true;
    return !archivedPrintIds.has(p.id);
  });
  const removed =
    pastLogs.length - trimmedPast.length + (printLogs.length - trimmedPrint.length);
  return { pastLogs: trimmedPast, printLogs: trimmedPrint, removed };
};

export const collectedArchivedIds = (
  accountId: string
): { logIds: Set<string>; printIds: Set<string> } => {
  const catalog = readArchiveCatalog(accountId);
  const logIds = new Set<string>();
  const printIds = new Set<string>();
  for (const pack of catalog.packs) {
    for (const id of pack.logIds) logIds.add(id);
    for (const id of pack.printIds) printIds.add(id);
  }
  return { logIds, printIds };
};
