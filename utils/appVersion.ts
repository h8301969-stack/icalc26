/** App version + GitHub / site release check for Install / Update UI. */

/**
 * This install’s version label.
 * CI bakes the next ordered git tag (0.0.1 → 0.0.2 → …) into VITE_APP_VERSION.
 * Never hardcode a package.json bump that jumped ahead of tags.
 */
export const APP_VERSION = normalizeEnvVersion(
  (import.meta.env.VITE_APP_VERSION as string | undefined) || '0.0.1'
);

/** CI sets VITE_APP_BUILD = GitHub Actions run number when packaging the APK. */
export const APP_BUILD = Number(import.meta.env.VITE_APP_BUILD ?? 0) || 0;

function normalizeEnvVersion(raw: string): string {
  const cleaned = String(raw).trim().replace(/^v/i, '');
  return /^\d+\.\d+\.\d+/.test(cleaned) ? cleaned.match(/^\d+\.\d+\.\d+/)![0] : '0.0.1';
}

export const GITHUB_REPO = 'h8301969-stack/icalc26';

/** Rolling APK asset from CI (`apk-latest` tag) — always the newest push build. */
export const APK_INSTALL_URL =
  `https://github.com/${GITHUB_REPO}/releases/download/apk-latest/icalc.apk`;

/** Same-origin fallback when Vercel serves public/icalc.apk. */
export const SITE_APK_PATH = '/icalc.apk';

export const RELEASE_META_PATH = '/app-release.json';

const STORAGE_ACK_BUILD = 'icalc_ack_release_build';
/** Build number the user cancelled/dismissed for (re-prompt only on inactivity return). */
const STORAGE_PROMPT_DISMISSED_BUILD = 'icalc_update_prompt_dismissed_build';
const STORAGE_LAST_HIDDEN_AT = 'icalc_last_hidden_at';
const SESSION_ACTIVE_START = 'icalc_session_active_start';
const SESSION_TWO_HOUR_FIRED = 'icalc_session_2h_prompt_fired';

/** First continuous active stretch before offering update (2 hours). */
export const UPDATE_PROMPT_ACTIVE_MS = 2 * 60 * 60 * 1000;
/** Away this long → next open counts as “entering after inactivity”. */
export const UPDATE_PROMPT_INACTIVITY_MS = 2 * 60 * 1000;

export type SemverTriple = [number, number, number];

export interface ReleaseMeta {
  version: string;
  build: number;
  sha?: string;
  apkUrl: string;
  stableApkUrl?: string;
  publishedAt?: string;
}

export const parseSemver = (raw: string): SemverTriple | null => {
  const m = String(raw).trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};

/** Positive if a > b, 0 if equal, negative if a < b. Invalid → 0. */
export const compareSemver = (a: string, b: string): number => {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
};

export const normalizeVersionLabel = (raw: string): string =>
  String(raw).trim().replace(/^v/i, '');

const githubHeaders = (): HeadersInit => ({
  Accept: 'application/vnd.github+json',
});

const parseReleaseMetaJson = (raw: unknown): ReleaseMeta | null => {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const version = typeof o.version === 'string' ? normalizeVersionLabel(o.version) : '';
  const build = Number(o.build ?? 0) || 0;
  const apkUrl =
    (typeof o.apkUrl === 'string' && o.apkUrl) ||
    (typeof o.stableApkUrl === 'string' && o.stableApkUrl) ||
    APK_INSTALL_URL;
  if (!version && !build) return null;
  return {
    version: version || APP_VERSION,
    build,
    sha: typeof o.sha === 'string' ? o.sha : undefined,
    apkUrl,
    stableApkUrl: typeof o.stableApkUrl === 'string' ? o.stableApkUrl : APK_INSTALL_URL,
    publishedAt: typeof o.publishedAt === 'string' ? o.publishedAt : undefined,
  };
};

/** Prefer same-origin mirror (updated by CI for the website). */
const fetchSiteReleaseMeta = async (): Promise<ReleaseMeta | null> => {
  try {
    const res = await fetch(`${RELEASE_META_PATH}?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return parseReleaseMetaJson(await res.json());
  } catch {
    return null;
  }
};

/** version.json attached to the rolling apk-latest GitHub release. */
const fetchGithubReleaseMetaAsset = async (): Promise<ReleaseMeta | null> => {
  try {
    const url = `https://github.com/${GITHUB_REPO}/releases/download/apk-latest/version.json?t=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return parseReleaseMetaJson(await res.json());
  } catch {
    return null;
  }
};

/** Parse build from tag `apk-42-sha` or release name `APK build 42`. */
const parseBuildFromRelease = (name?: string, tag?: string): number => {
  const fromName = name?.match(/APK build\s+(\d+)/i);
  if (fromName) return Number(fromName[1]) || 0;
  const fromTag = tag?.match(/^apk-(\d+)(?:-|$)/i);
  if (fromTag) return Number(fromTag[1]) || 0;
  return 0;
};

const fetchGithubLatestReleaseMeta = async (): Promise<ReleaseMeta | null> => {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/apk-latest`,
      { headers: githubHeaders(), cache: 'no-store' }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      name?: string;
      tag_name?: string;
      body?: string;
      published_at?: string;
      assets?: { name?: string; browser_download_url?: string }[];
    };
    const build = parseBuildFromRelease(data.name, data.tag_name);
    const bodyBuild = data.body?.match(/run\s*#?\s*(\d+)/i);
    const resolvedBuild = build || (bodyBuild ? Number(bodyBuild[1]) : 0) || 0;
    const apkAsset = data.assets?.find((a) => a.name === 'icalc.apk');
    const versionAsset = data.assets?.find((a) => a.name === 'version.json');
    if (versionAsset?.browser_download_url) {
      try {
        const vRes = await fetch(versionAsset.browser_download_url, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (vRes.ok) {
          const meta = parseReleaseMetaJson(await vRes.json());
          if (meta) return meta;
        }
      } catch {
        /* fall through */
      }
    }
    return {
      version: APP_VERSION,
      build: resolvedBuild,
      apkUrl: apkAsset?.browser_download_url || APK_INSTALL_URL,
      stableApkUrl: APK_INSTALL_URL,
      publishedAt: data.published_at,
    };
  } catch {
    return null;
  }
};

/**
 * Highest ordered semver tag on GitHub (0.0.1, 0.0.2, … — not apk-latest / apk-N-sha).
 */
export const fetchLatestSemverTag = async (): Promise<string | null> => {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/tags?per_page=100`,
      { headers: githubHeaders(), cache: 'no-store' }
    );
    if (!res.ok) return null;
    const tags = (await res.json()) as { name?: string }[];
    let best: string | null = null;
    for (const t of tags) {
      const name = t?.name;
      if (!name || !parseSemver(name)) continue;
      const label = normalizeVersionLabel(name);
      if (!best || compareSemver(label, best) > 0) best = label;
    }
    return best;
  } catch {
    return null;
  }
};

/**
 * Latest ordered release version (from meta or highest semver tag).
 */
export const fetchLatestReleaseVersion = async (): Promise<string | null> => {
  const meta = await fetchLatestReleaseMeta();
  if (meta?.version && parseSemver(meta.version)) return normalizeVersionLabel(meta.version);
  return fetchLatestSemverTag();
};

/**
 * Compute the next ordered patch tag after existing semver tags.
 * e.g. tags 0.0.1 → next 0.0.2. Used by CI; exported for tests.
 */
export const nextOrderedVersion = (tags: string[], fallback = '0.0.1'): string => {
  let best: string | null = null;
  for (const t of tags) {
    const label = normalizeVersionLabel(t);
    if (!parseSemver(label)) continue;
    if (!best || compareSemver(label, best) > 0) best = label;
  }
  if (!best) return fallback;
  const p = parseSemver(best)!;
  return `${p[0]}.${p[1]}.${p[2] + 1}`;
};

/** Full release metadata: site mirror → GitHub asset → GitHub API → highest tag. */
export const fetchLatestReleaseMeta = async (): Promise<ReleaseMeta | null> => {
  const site = await fetchSiteReleaseMeta();
  if (site && (site.build > 0 || parseSemver(site.version))) {
    // Prefer ordered tag label if site version is stale/missing
    if (parseSemver(site.version)) return site;
  }

  const asset = await fetchGithubReleaseMetaAsset();
  if (asset && (asset.build > 0 || parseSemver(asset.version))) return asset;

  const fromLatest = await fetchGithubLatestReleaseMeta();
  if (fromLatest) {
    const tag = await fetchLatestSemverTag();
    if (tag && (!fromLatest.version || !parseSemver(fromLatest.version) || compareSemver(tag, fromLatest.version) > 0)) {
      return { ...fromLatest, version: tag };
    }
    return fromLatest;
  }

  const tagOnly = await fetchLatestSemverTag();
  if (!tagOnly) return site;
  return {
    version: tagOnly,
    build: 0,
    apkUrl: APK_INSTALL_URL,
    stableApkUrl: APK_INSTALL_URL,
  };
};

export type AppInstallOffer =
  | { kind: 'install'; version: string; url: string; build: number }
  | { kind: 'update'; version: string; current: string; url: string; build: number }
  | { kind: 'current'; version: string; build: number };

export const resolveDownloadUrl = (meta: ReleaseMeta | null): string => {
  if (!meta) return APK_INSTALL_URL;
  return meta.stableApkUrl || meta.apkUrl || APK_INSTALL_URL;
};

/**
 * True when the published release is newer than this install.
 * Prefers build number (every CI push); falls back to semver.
 * When this binary has no baked build id, compare to last acknowledged download.
 */
export const isRemoteNewer = (meta: ReleaseMeta | null): boolean => {
  if (!meta) return false;
  if (meta.build > 0) {
    if (APP_BUILD > 0) return meta.build > APP_BUILD;
    return meta.build > getAcknowledgedReleaseBuild();
  }
  return compareSemver(meta.version, APP_VERSION) > 0;
};

/**
 * Web: Install (latest release link + label).
 * Native: Update when remote build/version is newer; otherwise “current”.
 */
export const resolveInstallOffer = (
  isNative: boolean,
  latestRemote: string | null,
  meta: ReleaseMeta | null = null
): AppInstallOffer => {
  const remoteVersion = meta?.version
    ? normalizeVersionLabel(meta.version)
    : latestRemote
      ? normalizeVersionLabel(latestRemote)
      : null;
  const current = APP_VERSION;
  const url = resolveDownloadUrl(meta);
  const build = meta?.build ?? 0;

  if (!isNative) {
    return {
      kind: 'install',
      version: remoteVersion ?? current,
      url,
      build,
    };
  }

  if (meta && isRemoteNewer(meta)) {
    return {
      kind: 'update',
      version: remoteVersion ?? meta.version,
      current,
      url,
      build,
    };
  }

  // Build-less compare (semver tags only)
  if (!meta && remoteVersion && compareSemver(remoteVersion, current) > 0) {
    return {
      kind: 'update',
      version: remoteVersion,
      current,
      url,
      build: 0,
    };
  }

  return { kind: 'current', version: current, build: APP_BUILD };
};

const safeGet = (store: Storage | undefined, key: string): string | null => {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const safeSet = (store: Storage | undefined, key: string, value: string) => {
  try {
    store?.setItem(key, value);
  } catch {
    /* ignore */
  }
};

const sessionStore = (): Storage | undefined =>
  typeof sessionStorage !== 'undefined' ? sessionStorage : undefined;
const localStore = (): Storage | undefined =>
  typeof localStorage !== 'undefined' ? localStorage : undefined;

/** Mark the start of this active session (first unlock / foreground). */
export const noteSessionActiveStart = (now = Date.now()): void => {
  if (!safeGet(sessionStore(), SESSION_ACTIVE_START)) {
    safeSet(sessionStore(), SESSION_ACTIVE_START, String(now));
  }
};

/** True once the user has been in this session for 2+ hours. */
export const hasCompletedFirstActiveTwoHours = (now = Date.now()): boolean => {
  const start = Number(safeGet(sessionStore(), SESSION_ACTIVE_START) ?? 0) || 0;
  if (!start) return false;
  return now - start >= UPDATE_PROMPT_ACTIVE_MS;
};

/** Call when the app/tab goes to background or locks. */
export const noteAppHidden = (now = Date.now()): void => {
  safeSet(localStore(), STORAGE_LAST_HIDDEN_AT, String(now));
};

/**
 * True when re-entering after being away long enough (inactivity).
 * Clears the hidden timestamp so it only fires once per return.
 */
export const consumeReturnFromInactivity = (
  now = Date.now(),
  minAwayMs = UPDATE_PROMPT_INACTIVITY_MS
): boolean => {
  const last = Number(safeGet(localStore(), STORAGE_LAST_HIDDEN_AT) ?? 0) || 0;
  if (!last) return false;
  const away = now - last >= minAwayMs;
  if (away) {
    try {
      localStore()?.removeItem(STORAGE_LAST_HIDDEN_AT);
    } catch {
      /* ignore */
    }
  }
  return away;
};

export const getDismissedUpdateBuild = (): number => {
  return Number(safeGet(localStore(), STORAGE_PROMPT_DISMISSED_BUILD) ?? 0) || 0;
};

/** Dismiss prompt for this release build (Cancel / after starting download). */
export const dismissUpdatePrompt = (build: number): void => {
  if (build > 0) {
    safeSet(localStore(), STORAGE_PROMPT_DISMISSED_BUILD, String(build));
  } else {
    // No build id — mark session so 2h path doesn’t immediately re-open
    safeSet(sessionStore(), SESSION_TWO_HOUR_FIRED, '1');
  }
};

/**
 * Whether the update popup may open now.
 * Triggers: (1) first active 2 hours this session, or (2) re-entry after inactivity.
 * After Cancel for a build, only inactivity re-entry can show that same build again.
 */
export const shouldShowActivityUpdatePrompt = (opts: {
  updateAvailable: boolean;
  remoteBuild: number;
  twoHourReady: boolean;
  returnedFromInactivity: boolean;
}): boolean => {
  if (!opts.updateAvailable) return false;

  const dismissedBuild = getDismissedUpdateBuild();
  const sameBuildDismissed =
    opts.remoteBuild > 0 && dismissedBuild > 0 && dismissedBuild === opts.remoteBuild;

  if (opts.returnedFromInactivity) {
    // Always allow after inactivity (even if previously cancelled for this build)
    return true;
  }

  if (sameBuildDismissed) return false;

  if (opts.twoHourReady) {
    if (safeGet(sessionStore(), SESSION_TWO_HOUR_FIRED) === '1') return false;
    return true;
  }

  return false;
};

/** Mark that the 2-hour session prompt already opened (or was dismissed). */
export const markTwoHourPromptFired = (): void => {
  safeSet(sessionStore(), SESSION_TWO_HOUR_FIRED, '1');
};

/** @deprecated Use shouldShowActivityUpdatePrompt — kept for any stale imports. */
export const shouldShowEightAmGmtPrompt = (): boolean => false;

/** @deprecated Use dismissUpdatePrompt */
export const dismissUpdatePromptForToday = (): void => {
  dismissUpdatePrompt(getAcknowledgedReleaseBuild() || getDismissedUpdateBuild() || 0);
};

export const gmtDateKey = (now = new Date()): string => {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const getAcknowledgedReleaseBuild = (): number => {
  try {
    return Number(localStorage.getItem(STORAGE_ACK_BUILD) ?? 0) || 0;
  } catch {
    return 0;
  }
};

export const acknowledgeReleaseBuild = (build: number) => {
  try {
    if (build > 0) localStorage.setItem(STORAGE_ACK_BUILD, String(build));
  } catch {
    /* ignore */
  }
};

/**
 * Should we nag about an update?
 * - Native: remote newer than this binary
 * - Web: remote build newer than last acknowledged (or any release if never acked)
 */
export const shouldOfferUpdate = (isNative: boolean, meta: ReleaseMeta | null): boolean => {
  if (!meta) return false;
  if (isNative) return isRemoteNewer(meta);
  const ack = getAcknowledgedReleaseBuild();
  if (meta.build > 0) return meta.build > ack;
  // No build meta: still offer daily install of rolling APK once until acked for "today"
  return ack === 0;
};

/** Start APK download without leaving the app flow (new tab / background). */
export const startBackgroundApkDownload = (url: string) => {
  const href = url || APK_INSTALL_URL;
  try {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.download = 'icalc.apk';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    window.open(href, '_blank', 'noopener,noreferrer');
  }
};
