import { describe, expect, it } from 'vitest';
import {
  buildPhoneUpdateStatus,
  compareSemver,
  formatReleaseElapsed,
} from './appRelease';

describe('compareSemver', () => {
  it('orders versions', () => {
    expect(compareSemver('0.0.25', '0.0.26')).toBeLessThan(0);
    expect(compareSemver('0.0.26', '0.0.26')).toBe(0);
    expect(compareSemver('0.1.0', '0.0.99')).toBeGreaterThan(0);
  });
});

describe('formatReleaseElapsed', () => {
  it('formats compact elapsed labels', () => {
    const now = 1_700_000_000_000;
    expect(formatReleaseElapsed(now - 45_000, now)).toBe('45s');
    expect(formatReleaseElapsed(now - 5 * 60_000, now)).toBe('5m');
    expect(formatReleaseElapsed(now - (2 * 60 + 15) * 60_000, now)).toBe('2h 15m');
  });
});

describe('buildPhoneUpdateStatus', () => {
  const release = {
    publishedAt: Date.now() - 10 * 60_000,
    name: 'Latest APK 0.0.26',
    tag: 'apk-latest',
    version: '0.0.26',
    sha: 'abc1234',
  };

  it('reports current version', () => {
    const status = buildPhoneUpdateStatus('0.0.26', release, release.publishedAt + 10 * 60_000);
    expect(status.kind).toBe('current');
    if (status.kind === 'current') {
      expect(status.message).toContain('current version');
      expect(status.message).toContain('10m');
    }
  });

  it('reports update available', () => {
    const status = buildPhoneUpdateStatus('0.0.25', release, release.publishedAt + 10 * 60_000);
    expect(status.kind).toBe('update');
    if (status.kind === 'update') {
      expect(status.latestVersion).toBe('0.0.26');
      expect(status.message).toContain('New update available');
    }
  });
});
