import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';

/** Rolling phone build published via GitHub Releases (apk-latest tag). */
export const PHONE_APP_DOWNLOAD_URL =
  'https://github.com/h8301969-stack/icalc26/releases/download/apk-latest/icalc.apk';

const RELEASE_API_URL =
  'https://api.github.com/repos/h8301969-stack/icalc26/releases/tags/apk-latest';

/** Semver baked into this web/native bundle from package.json (via vite define). */
declare const __APP_VERSION__: string;
export const APP_PACKAGE_VERSION =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__.trim()
    ? __APP_VERSION__.trim()
    : '0.0.0';

export interface AppReleaseInfo {
  publishedAt: number;
  name: string;
  tag: string;
  /** Parsed from release body `App-Version: x.y.z` when present. */
  version: string | null;
  sha: string | null;
}

export type PhoneUpdateStatus =
  | { kind: 'loading' }
  | { kind: 'unknown'; message: string }
  | { kind: 'current'; message: string; installedVersion: string; latestVersion: string | null }
  | { kind: 'update'; message: string; installedVersion: string; latestVersion: string };

/** Compact elapsed label, e.g. "12m", "3h 20m", "2d 4h". */
export function formatReleaseElapsed(timestamp: number, now = Date.now()): string {
  const ms = Math.max(0, now - timestamp);
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (secs < 60) return `${secs}s`;
  if (mins < 60) return `${mins}m`;
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${days}d ${hrs % 24}h`;
}

function parseSemverParts(version: string): number[] | null {
  const cleaned = version.trim().replace(/^v/i, '');
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Returns negative if a < b, 0 if equal, positive if a > b. Null if unparsable. */
export function compareSemver(a: string, b: string): number | null {
  const pa = parseSemverParts(a);
  const pb = parseSemverParts(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function parseVersionFromText(text: string | undefined | null): string | null {
  if (!text) return null;
  const labeled = text.match(/App-Version:\s*v?(\d+\.\d+\.\d+)/i);
  if (labeled?.[1]) return labeled[1];
  const named = text.match(/\bv?(\d+\.\d+\.\d+)\b/);
  return named?.[1] ?? null;
}

function parseShaFromText(text: string | undefined | null): string | null {
  if (!text) return null;
  const labeled = text.match(/Commit:\s*`?([0-9a-f]{7,40})`?/i);
  if (labeled?.[1]) return labeled[1];
  const backtick = text.match(/`([0-9a-f]{40})`/i);
  return backtick?.[1] ?? null;
}

export async function fetchLatestPhoneRelease(): Promise<AppReleaseInfo | null> {
  try {
    const res = await fetch(RELEASE_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      tag_name?: string;
      name?: string;
      body?: string;
      published_at?: string;
      assets?: Array<{ name?: string; updated_at?: string; created_at?: string }>;
    };
    const asset =
      data.assets?.find((a) => (a.name ?? '').toLowerCase().endsWith('.apk')) ??
      data.assets?.[0];
    const stamp =
      asset?.updated_at ||
      asset?.created_at ||
      data.published_at ||
      null;
    if (!stamp) return null;
    const body = data.body ?? '';
    return {
      publishedAt: new Date(stamp).getTime(),
      name: data.name || data.tag_name || 'latest',
      tag: data.tag_name || 'apk-latest',
      version: parseVersionFromText(body) || parseVersionFromText(data.name),
      sha: parseShaFromText(body),
    };
  } catch {
    return null;
  }
}

/** Installed app version on native; falls back to package.json for web/dev. */
export async function getInstalledAppVersion(): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    try {
      const info = await CapApp.getInfo();
      if (info.version?.trim()) return info.version.trim();
    } catch {
      // fall through
    }
  }
  return APP_PACKAGE_VERSION;
}

export function buildPhoneUpdateStatus(
  installedVersion: string,
  release: AppReleaseInfo | null,
  now = Date.now()
): PhoneUpdateStatus {
  if (!release) {
    return {
      kind: 'unknown',
      message: 'Couldn’t check for updates right now.',
    };
  }

  const elapsed = formatReleaseElapsed(release.publishedAt, now);
  const latestVersion = release.version;

  if (!latestVersion) {
    return {
      kind: 'unknown',
      message: `Latest build published ${elapsed} ago`,
    };
  }

  const cmp = compareSemver(installedVersion, latestVersion);
  if (cmp === null) {
    return {
      kind: 'unknown',
      message: `Installed ${installedVersion} · latest ${latestVersion} · ${elapsed} ago`,
    };
  }

  if (cmp >= 0) {
    return {
      kind: 'current',
      installedVersion,
      latestVersion,
      message: `You’re on the current version (${installedVersion}) · Updated ${elapsed} ago`,
    };
  }

  return {
    kind: 'update',
    installedVersion,
    latestVersion,
    message: `New update available (${latestVersion}) · Released ${elapsed} ago`,
  };
}
