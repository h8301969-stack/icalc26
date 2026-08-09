/**
 * Global trio-press: every clickable control uses the same spring
 * morph language as Settings Save/Discard / Vision Hub actions.
 *
 * On pointerdown we add `.animate-trio-press`; animationend clears it.
 * Prefer this over scattered active:scale-* utilities.
 */

const PRESS_CLASS = 'animate-trio-press';
const PRESS_SOFT = 'animate-trio-press--soft';
const PRESS_SOFT_LG = 'animate-trio-press--soft-lg';
const PRESS_DASH_CARD = 'animate-trio-press--dash-card';
const SKIP_ATTR = 'data-no-trio-press';

/** Height/width (px) above which press scale is milder vs chip (blur unchanged). */
const SOFT_MIN = 44;
/** Area (px²) / full-width CTAs — even softer scale. */
const SOFT_LG_MIN_W = 160;
const SOFT_LG_MIN_H = 48;
const SOFT_LG_MIN_AREA = 9000;

const CLICKABLE_SELECTOR = [
  'button',
  'a[href]',
  'summary',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="link"]',
  'label[for]',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  '[data-trio-press]',
  '.trio-pressable',
  '.vision-hub-trio-pressable',
  '.pos-dashboard-icon-lift',
  '.vision-hub-click-row',
  '.calc-key',
  '.cursor-pointer',
].join(',');

const SKIP_SELECTOR = [
  `[${SKIP_ATTR}]`,
  'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"])',
  'textarea',
  'select',
  '[contenteditable="true"]',
].join(',');

function isDisabled(el: Element): boolean {
  if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) {
    if (el.disabled) return true;
  }
  if (el.getAttribute('aria-disabled') === 'true') return true;
  if (el.hasAttribute('disabled')) return true;
  return false;
}

function isScrollSurface(el: HTMLElement): boolean {
  const st = getComputedStyle(el);
  const oy = st.overflowY;
  const ox = st.overflowX;
  if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 4) return true;
  if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 4) return true;
  return false;
}

function isVisibleClickable(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (isDisabled(el)) return false;
  if (el.closest(`[${SKIP_ATTR}]`)) return false;
  // Full-screen dismiss layers — no trio morph
  if (el.classList.contains('vision-hub-backdrop')) return false;
  if (el.classList.contains('morph-scrim')) return false;
  if (el.classList.contains('auth-screen')) return false;
  if (isScrollSurface(el) && !el.matches('button, a, [role="button"], .calc-key')) return false;
  return true;
}

/**
 * Walk from event target to find the nearest trio-press target.
 */
export function findTrioPressTarget(target: EventTarget | null): HTMLElement | null {
  let node: Element | null = target instanceof Element ? target : null;
  while (node && node !== document.documentElement) {
    if (node instanceof HTMLElement) {
      // Explicit opt-out on self
      if (node.hasAttribute(SKIP_ATTR)) {
        node = node.parentElement;
        continue;
      }

      if (node.matches(CLICKABLE_SELECTOR) && isVisibleClickable(node)) {
        return node;
      }

      // React onClick cards (no role) — pointer cursor + not a scroll pane
      if (
        node.classList.contains('cursor-pointer') ||
        node.getAttribute('role') === 'button' ||
        node.classList.contains('pos-dashboard-card-motion')
      ) {
        if (isVisibleClickable(node)) {
          return node;
        }
      }
    }
    node = node.parentElement;
  }
  return null;
}

function clearPress(el: HTMLElement) {
  el.classList.remove(PRESS_CLASS, PRESS_SOFT, PRESS_SOFT_LG, PRESS_DASH_CARD);
  el.removeAttribute('data-trio-pressing');
}

/** POS dashboard cards (levitate / card-motion tiles). */
function isDashboardCard(el: HTMLElement): boolean {
  if (el.classList.contains('pos-dashboard-card-motion')) return true;
  if (el.classList.contains('pos-dashboard-card-glass')) return true;
  // Clickable tiles inside the dashboard hub / expanded views
  if (!el.closest('.pos-dashboard, .pos-dashboard-root')) return false;
  if (el.classList.contains('cursor-pointer') && (el.classList.contains('rounded-xl') || el.classList.contains('rounded-2xl'))) {
    return true;
  }
  if (el.getAttribute('role') === 'button') {
    const r = el.getBoundingClientRect();
    if (r.width >= 100 && r.height >= 56) return true;
  }
  return false;
}

/**
 * Size / surface class — only adjusts scale (subtle on large surfaces);
 * blur always full strength in CSS.
 */
function pressSizeClass(el: HTMLElement): string {
  if (isDashboardCard(el)) {
    return PRESS_DASH_CARD; // scale ~0.96 — slight press only
  }
  const r = el.getBoundingClientRect();
  const w = r.width;
  const h = r.height;
  const area = w * h;
  if (w >= SOFT_LG_MIN_W || h >= SOFT_LG_MIN_H * 1.4 || area >= SOFT_LG_MIN_AREA) {
    return PRESS_SOFT_LG;
  }
  if (w >= SOFT_MIN || h >= SOFT_MIN || el.classList.contains('calc-key')) {
    return PRESS_SOFT;
  }
  return '';
}

function playTrioPress(el: HTMLElement) {
  // Restart animation if already playing
  clearPress(el);
  // Force reflow so re-adding class retriggers keyframes
  void el.offsetWidth;
  const sizeClass = pressSizeClass(el);
  el.classList.add(PRESS_CLASS);
  if (sizeClass) el.classList.add(sizeClass);
  el.setAttribute('data-trio-pressing', '1');

  const onEnd = (e: AnimationEvent) => {
    if (e.target !== el) return;
    const name = e.animationName || '';
    if (!name.includes('trio-press') && !el.classList.contains(PRESS_CLASS)) return;
    el.removeEventListener('animationend', onEnd);
    clearPress(el);
  };
  el.addEventListener('animationend', onEnd);

  // Safety clear if animationend is missed
  window.setTimeout(() => {
    if (el.getAttribute('data-trio-pressing') === '1') {
      clearPress(el);
    }
  }, 400);
}

/**
 * Install document-level trio press. Idempotent. Returns disposer.
 */
export function installTrioPress(): () => void {
  const onPointerDown = (e: PointerEvent) => {
    // Primary button / touch / pen only
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const target = findTrioPressTarget(e.target);
    if (!target) return;
    // Don't fight text selection on long-press fields
    if (target.closest('input, textarea, [contenteditable="true"]') &&
        !target.matches('button, [role="button"], input[type="button"], input[type="submit"]')) {
      return;
    }
    playTrioPress(target);
  };

  // Keyboard activation (Enter/Space on focused control)
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const active = document.activeElement;
    if (!active || !(active instanceof HTMLElement)) return;
    if (!active.matches(CLICKABLE_SELECTOR)) return;
    if (!isVisibleClickable(active)) return;
    if (e.key === ' ' && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
      return;
    }
    playTrioPress(active);
  };

  document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  document.addEventListener('keydown', onKeyDown, { capture: true });

  // Mark the document so CSS can assume global trio is live
  document.documentElement.classList.add('trio-press-global');

  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.documentElement.classList.remove('trio-press-global');
  };
}

export { PRESS_CLASS as TRIO_PRESS_CLASS };
