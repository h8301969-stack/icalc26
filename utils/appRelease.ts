/** Rolling phone build published via GitHub Releases (apk-latest tag). */
export const PHONE_APP_DOWNLOAD_URL =
  'https://github.com/h8301969-stack/icalc26/releases/download/apk-latest/icalc.apk';

const RELEASE_API_URL =
  'https://api.github.com/repos/h8301969-stack/icalc26/releases/tags/apk-latest';

export interface AppReleaseInfo {
  publishedAt: number;
  name: string;
  tag: string;
}

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

export async function fetchLatestPhoneRelease(): Promise<AppReleaseInfo | null> {
  try {
    const res = await fetch(RELEASE_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      tag_name?: string;
      name?: string;
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
    return {
      publishedAt: new Date(stamp).getTime(),
      name: data.name || data.tag_name || 'latest',
      tag: data.tag_name || 'apk-latest',
    };
  } catch {
    return null;
  }
}
