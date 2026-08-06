import { describe, expect, it } from 'vitest';
import {
  compareSemver,
  nextOrderedVersion,
  resolveInstallOffer,
  shouldShowActivityUpdatePrompt,
  type ReleaseMeta,
} from './appVersion';

describe('appVersion', () => {
  it('compares semver', () => {
    expect(compareSemver('0.0.2', '0.0.1')).toBeGreaterThan(0);
    expect(compareSemver('0.0.1', '0.0.2')).toBeLessThan(0);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
  });

  it('next ordered tag bumps patch in order', () => {
    expect(nextOrderedVersion([])).toBe('0.0.1');
    expect(nextOrderedVersion(['0.0.1'])).toBe('0.0.2');
    expect(nextOrderedVersion(['0.0.1', '0.0.2', 'apk-latest', 'apk-3-abc'])).toBe('0.0.3');
    expect(nextOrderedVersion(['0.0.10', '0.0.2'])).toBe('0.0.11');
  });

  it('web always offers install with release url', () => {
    const meta: ReleaseMeta = {
      version: '0.0.2',
      build: 12,
      apkUrl: 'https://example.com/a.apk',
      stableApkUrl: 'https://example.com/stable.apk',
    };
    const offer = resolveInstallOffer(false, '0.0.2', meta);
    expect(offer.kind).toBe('install');
    if (offer.kind === 'install') {
      expect(offer.url).toBe('https://example.com/stable.apk');
      expect(offer.version).toBe('0.0.2');
      expect(offer.build).toBe(12);
    }
  });

  it('native shows update when remote ordered tag is newer', () => {
    const meta: ReleaseMeta = {
      version: '9.9.9',
      build: 0,
      apkUrl: 'https://example.com/a.apk',
    };
    const offer = resolveInstallOffer(true, '9.9.9', meta);
    expect(offer.kind).toBe('update');
  });

  it('activity prompt: 2h or inactivity return, not without a trigger', () => {
    expect(
      shouldShowActivityUpdatePrompt({
        updateAvailable: true,
        remoteBuild: 5,
        twoHourReady: false,
        returnedFromInactivity: false,
      })
    ).toBe(false);

    expect(
      shouldShowActivityUpdatePrompt({
        updateAvailable: true,
        remoteBuild: 5,
        twoHourReady: true,
        returnedFromInactivity: false,
      })
    ).toBe(true);

    expect(
      shouldShowActivityUpdatePrompt({
        updateAvailable: true,
        remoteBuild: 5,
        twoHourReady: false,
        returnedFromInactivity: true,
      })
    ).toBe(true);

    expect(
      shouldShowActivityUpdatePrompt({
        updateAvailable: false,
        remoteBuild: 5,
        twoHourReady: true,
        returnedFromInactivity: true,
      })
    ).toBe(false);
  });
});
