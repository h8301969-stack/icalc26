import { storage } from '../hooks/storage';

const PRESENCE_KEY = 'icalc_profile_presence';

export interface ProfilePresence {
  /** Last time this profile was the active one on this device */
  lastSeenAt: number;
  /** First time this profile became active in the current stretch */
  sessionStartedAt: number;
  /** Last time this profile was switched to (login on device) */
  lastLoginAt: number;
}

type PresenceMap = Record<string, ProfilePresence>;

const readMap = (): PresenceMap => storage.get<PresenceMap>(PRESENCE_KEY, {});

const writeMap = (map: PresenceMap) => storage.set(PRESENCE_KEY, map);

export const getProfilePresence = (profileId: string): ProfilePresence | null => {
  if (!profileId) return null;
  return readMap()[profileId] ?? null;
};

/** Call when a profile becomes active on this device. */
export const touchProfilePresence = (profileId: string, at = Date.now()): ProfilePresence => {
  const map = readMap();
  const prev = map[profileId];
  const next: ProfilePresence = {
    lastSeenAt: at,
    lastLoginAt: at,
    sessionStartedAt: prev?.sessionStartedAt && at - prev.lastSeenAt < 5 * 60_000
      ? prev.sessionStartedAt
      : at,
  };
  map[profileId] = next;
  writeMap(map);
  return next;
};

/** Heartbeat while a profile stays active. */
export const heartbeatProfilePresence = (profileId: string, at = Date.now()): void => {
  if (!profileId) return;
  const map = readMap();
  const prev = map[profileId];
  if (!prev) {
    touchProfilePresence(profileId, at);
    return;
  }
  map[profileId] = { ...prev, lastSeenAt: at };
  writeMap(map);
};

export const formatPresenceTime = (timestamp: number, now = Date.now()): string => {
  const ms = Math.max(0, now - timestamp);
  const mins = Math.floor(ms / 60_000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};
