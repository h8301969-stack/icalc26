import { storage } from '../hooks/storage';

/** Timestamp of last 4:00 AM stash cutoff (invoices before this are archived from the live drawer). */
const STASH_CUTOFF_KEY = 'vision_hub_stash_cutoff';

export const getVisionHubStashCutoff = (): number =>
  storage.get<number>(STASH_CUTOFF_KEY, 0) || 0;

export const setVisionHubStashCutoff = (ts: number): void => {
  storage.set(STASH_CUTOFF_KEY, ts);
};

/** Local 4:00 AM on the calendar day of `date`. */
export const getFourAmOn = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 4, 0, 0, 0).getTime();

/**
 * If we've passed a 4:00 AM boundary since last stash, advance the cutoff.
 * Returns the active cutoff timestamp.
 */
export const runVisionHubStashIfDue = (now = new Date()): number => {
  const nowMs = now.getTime();
  const fourAmToday = getFourAmOn(now);
  const last = getVisionHubStashCutoff();

  if (nowMs >= fourAmToday) {
    if (last < fourAmToday) {
      setVisionHubStashCutoff(fourAmToday);
      return fourAmToday;
    }
    return last;
  }

  // Before 4am: ensure yesterday's 4am stash has been applied
  const fourAmYesterday = fourAmToday - 24 * 60 * 60 * 1000;
  if (last < fourAmYesterday) {
    setVisionHubStashCutoff(fourAmYesterday);
    return fourAmYesterday;
  }
  return last;
};

/** ms until next local 4:00 AM (min 1s). */
export const msUntilNextFourAm = (now = new Date()): number => {
  const fourAmToday = getFourAmOn(now);
  const next =
    now.getTime() < fourAmToday ? fourAmToday : fourAmToday + 24 * 60 * 60 * 1000;
  return Math.max(1000, next - now.getTime());
};

/** Day key YYYY-MM-DD in local time. */
export const dayKeyFromTs = (ts: number): string => {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** Label like 09/08 for a day key or timestamp. */
export const formatDayButtonLabel = (tsOrKey: number | string): string => {
  const d =
    typeof tsOrKey === 'number'
      ? new Date(tsOrKey)
      : new Date(`${tsOrKey}T12:00:00`);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
};

export const startOfDayTs = (ts: number): number => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

export const endOfDayTs = (ts: number): number => startOfDayTs(ts) + 24 * 60 * 60 * 1000 - 1;

/**
 * Inclusive list of day-start timestamps from firstInvoiceDay → today (local).
 * Oldest first for the date drawer list.
 */
export const buildInvoiceDayList = (firstInvoiceTs: number, now = Date.now()): number[] => {
  if (!firstInvoiceTs || !Number.isFinite(firstInvoiceTs)) {
    return [startOfDayTs(now)];
  }
  let cursor = startOfDayTs(firstInvoiceTs);
  const end = startOfDayTs(now);
  if (cursor > end) return [end];
  const days: number[] = [];
  // Cap to 400 days to avoid huge lists
  let guard = 0;
  while (cursor <= end && guard < 400) {
    days.push(cursor);
    cursor += 24 * 60 * 60 * 1000;
    guard += 1;
  }
  return days;
};
