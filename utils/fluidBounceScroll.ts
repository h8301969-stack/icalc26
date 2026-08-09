/**
 * iOS-style fluid rubber-band bounce for every overflow scroll surface.
 * Uses the same spring + rubberBand math as the rest of the Fluid Interface.
 */
import { animateSpring, rubberBand, type SpringHandle } from './fluidSpring';

const ENHANCED = new WeakSet<HTMLElement>();
const BOUNCE_ATTR = 'data-fluid-bounce';

/** UIKit-ish constant; higher = tighter resistance past the edge. */
const RUBBER = 0.55;
/** How far past the edge the band can travel (fraction of viewport). */
const MAX_BAND_FRAC = 0.42;
/** Wheel → overscroll gain. */
const WHEEL_GAIN = 0.42;

type Axis = 'y' | 'x';

type BounceState = {
  y: number;
  x: number;
  springY: SpringHandle | null;
  springX: SpringHandle | null;
  touchId: number | null;
  startY: number;
  startX: number;
  startScrollTop: number;
  startScrollLeft: number;
  lastY: number;
  lastX: number;
  lastT: number;
  velY: number;
  velX: number;
  active: boolean;
  wheelTimer: number | null;
};

const states = new WeakMap<HTMLElement, BounceState>();

function overflowAllows(style: CSSStyleDeclaration, axis: Axis): boolean {
  const v = axis === 'y' ? style.overflowY : style.overflowX;
  return v === 'auto' || v === 'scroll' || v === 'overlay';
}

function canScroll(el: HTMLElement, axis: Axis): boolean {
  if (axis === 'y') return el.scrollHeight > el.clientHeight + 1;
  return el.scrollWidth > el.clientWidth + 1;
}

export function findScrollParent(
  target: EventTarget | null,
  axis: Axis = 'y'
): HTMLElement | null {
  let node: HTMLElement | null =
    target instanceof Element ? (target as HTMLElement) : null;
  while (node && node !== document.documentElement) {
    if (node instanceof HTMLElement) {
      const st = getComputedStyle(node);
      if (overflowAllows(st, axis) && canScroll(node, axis)) {
        return node;
      }
      // Prefer vertical scroller when both axes work
      if (axis === 'y' && overflowAllows(st, 'x') && canScroll(node, 'x')) {
        // keep searching for y-first parent
      }
    }
    node = node.parentElement;
  }
  return null;
}

function getState(el: HTMLElement): BounceState {
  let s = states.get(el);
  if (!s) {
    s = {
      y: 0,
      x: 0,
      springY: null,
      springX: null,
      touchId: null,
      startY: 0,
      startX: 0,
      startScrollTop: 0,
      startScrollLeft: 0,
      lastY: 0,
      lastX: 0,
      lastT: 0,
      velY: 0,
      velX: 0,
      active: false,
      wheelTimer: null,
    };
    states.set(el, s);
  }
  return s;
}

function applyTransform(el: HTMLElement, s: BounceState) {
  const y = s.y;
  const x = s.x;
  if (Math.abs(y) < 0.15 && Math.abs(x) < 0.15) {
    el.style.transform = '';
    el.style.willChange = '';
    el.removeAttribute(BOUNCE_ATTR);
    return;
  }
  el.setAttribute(BOUNCE_ATTR, '1');
  el.style.willChange = 'transform';
  el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
}

function stopSprings(s: BounceState) {
  s.springY?.stop();
  s.springX?.stop();
  s.springY = null;
  s.springX = null;
}

function springAxis(
  el: HTMLElement,
  s: BounceState,
  axis: Axis,
  velocity: number
) {
  const from = axis === 'y' ? s.y : s.x;
  if (Math.abs(from) < 0.2) {
    if (axis === 'y') s.y = 0;
    else s.x = 0;
    applyTransform(el, s);
    return;
  }

  const handle = animateSpring(
    from,
    0,
    velocity,
    (v) => {
      if (axis === 'y') s.y = v;
      else s.x = v;
      applyTransform(el, s);
    },
    () => {
      if (axis === 'y') {
        s.y = 0;
        s.springY = null;
      } else {
        s.x = 0;
        s.springX = null;
      }
      applyTransform(el, s);
    },
    {
      // Slightly softer than chip presses so bounce feels like UIScrollView
      mass: 0.85,
      damping: 26,
      stiffness: 280,
      overshootClamping: false,
    }
  );

  if (axis === 'y') s.springY = handle;
  else s.springX = handle;
}

function settle(el: HTMLElement, s: BounceState) {
  springAxis(el, s, 'y', s.velY);
  springAxis(el, s, 'x', s.velX);
}

function bandOffset(
  raw: number,
  dim: number,
  /** positive raw = pull past start (top/left) */
  pastStart: boolean
): number {
  const maxBand = Math.max(48, dim * MAX_BAND_FRAC);
  if (pastStart) {
    // raw > 0 → positive bounce
    return rubberBand(raw, 0, maxBand * 4, maxBand, RUBBER);
  }
  // raw < 0 → negative bounce
  return rubberBand(raw, -maxBand * 4, 0, maxBand, RUBBER);
}

function atStart(el: HTMLElement, axis: Axis): boolean {
  return axis === 'y' ? el.scrollTop <= 0.5 : el.scrollLeft <= 0.5;
}

function atEnd(el: HTMLElement, axis: Axis): boolean {
  if (axis === 'y') {
    return el.scrollTop + el.clientHeight >= el.scrollHeight - 0.5;
  }
  return el.scrollLeft + el.clientWidth >= el.scrollWidth - 0.5;
}

function onTouchStart(el: HTMLElement, e: TouchEvent) {
  if (e.touches.length !== 1) return;
  const s = getState(el);
  stopSprings(s);
  const t = e.touches[0];
  s.touchId = t.identifier;
  s.startY = t.clientY;
  s.startX = t.clientX;
  s.startScrollTop = el.scrollTop;
  s.startScrollLeft = el.scrollLeft;
  s.lastY = t.clientY;
  s.lastX = t.clientX;
  s.lastT = performance.now();
  s.velY = 0;
  s.velX = 0;
  s.active = true;
  // Keep any residual bounce; new gesture can continue
}

function onTouchMove(el: HTMLElement, e: TouchEvent) {
  const s = getState(el);
  if (!s.active || s.touchId == null) return;
  let t: Touch | null = null;
  for (let i = 0; i < e.touches.length; i++) {
    if (e.touches[i].identifier === s.touchId) {
      t = e.touches[i];
      break;
    }
  }
  if (!t) return;

  const now = performance.now();
  const dt = Math.max(1, now - s.lastT);
  const dy = t.clientY - s.lastY;
  const dx = t.clientX - s.lastX;
  s.velY = dy / dt;
  s.velX = dx / dt;
  s.lastY = t.clientY;
  s.lastX = t.clientX;
  s.lastT = now;

  const totalDy = t.clientY - s.startY;
  const totalDx = t.clientX - s.startX;

  let handled = false;

  // Vertical rubber-band
  if (canScroll(el, 'y') || Math.abs(s.y) > 0.5) {
    const pullDown = totalDy > 0 && atStart(el, 'y') && s.startScrollTop <= 0.5;
    const pullUp =
      totalDy < 0 &&
      atEnd(el, 'y') &&
      s.startScrollTop + el.clientHeight >= el.scrollHeight - 1;
    // Continue band if already overscrolled
    if (pullDown || (s.y > 0.5 && totalDy !== 0 && atStart(el, 'y'))) {
      const raw = totalDy - (el.scrollTop - s.startScrollTop);
      s.y = bandOffset(Math.max(0, raw), el.clientHeight, true);
      handled = true;
    } else if (pullUp || (s.y < -0.5 && totalDy !== 0 && atEnd(el, 'y'))) {
      const over =
        s.startScrollTop + el.clientHeight - el.scrollHeight - totalDy;
      // when pulling up, totalDy is negative; map to negative bounce
      const raw = Math.min(0, totalDy + (el.scrollTop - s.startScrollTop));
      s.y = bandOffset(raw, el.clientHeight, false);
      handled = true;
      void over;
    } else if (Math.abs(s.y) > 0.5 && !atStart(el, 'y') && !atEnd(el, 'y')) {
      // User scrolled back into content — clear bounce
      s.y = 0;
    }
  }

  // Horizontal rubber-band (expression strip, carousels)
  if (canScroll(el, 'x') || Math.abs(s.x) > 0.5) {
    const pullRight = totalDx > 0 && atStart(el, 'x') && s.startScrollLeft <= 0.5;
    const pullLeft =
      totalDx < 0 &&
      atEnd(el, 'x') &&
      s.startScrollLeft + el.clientWidth >= el.scrollWidth - 1;
    if (pullRight || (s.x > 0.5 && atStart(el, 'x'))) {
      s.x = bandOffset(Math.max(0, totalDx), el.clientWidth, true);
      handled = true;
    } else if (pullLeft || (s.x < -0.5 && atEnd(el, 'x'))) {
      s.x = bandOffset(Math.min(0, totalDx), el.clientWidth, false);
      handled = true;
    } else if (Math.abs(s.x) > 0.5 && !atStart(el, 'x') && !atEnd(el, 'x')) {
      s.x = 0;
    }
  }

  if (handled && (Math.abs(s.y) > 0.5 || Math.abs(s.x) > 0.5)) {
    if (e.cancelable) e.preventDefault();
    applyTransform(el, s);
  } else {
    applyTransform(el, s);
  }
}

function onTouchEnd(el: HTMLElement, e: TouchEvent) {
  const s = getState(el);
  if (!s.active) return;
  if (s.touchId != null) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === s.touchId) {
        s.touchId = null;
        s.active = false;
        settle(el, s);
        return;
      }
    }
  }
}

function onWheel(el: HTMLElement, e: WheelEvent) {
  // Prefer the axis with more delta
  const mostlyY = Math.abs(e.deltaY) >= Math.abs(e.deltaX);
  const s = getState(el);
  stopSprings(s);

  let handled = false;

  if (mostlyY && (canScroll(el, 'y') || Math.abs(s.y) > 0.5)) {
    const atTop = atStart(el, 'y');
    const atBot = atEnd(el, 'y');
    if ((atTop && e.deltaY < 0) || (atBot && e.deltaY > 0) || Math.abs(s.y) > 0.5) {
      const next = s.y - e.deltaY * WHEEL_GAIN;
      const dim = el.clientHeight;
      const maxBand = Math.max(48, dim * MAX_BAND_FRAC);
      s.y = rubberBand(next, -maxBand, maxBand, maxBand, RUBBER);
      // If still in-range of content scroll, let browser handle
      if (Math.abs(s.y) > 0.5 && ((atTop && e.deltaY < 0) || (atBot && e.deltaY > 0))) {
        handled = true;
      } else if (Math.abs(s.y) <= 0.5) {
        s.y = 0;
      } else {
        handled = true;
      }
    }
  } else if (!mostlyY && (canScroll(el, 'x') || Math.abs(s.x) > 0.5)) {
    const atL = atStart(el, 'x');
    const atR = atEnd(el, 'x');
    if ((atL && e.deltaX < 0) || (atR && e.deltaX > 0) || Math.abs(s.x) > 0.5) {
      const next = s.x - e.deltaX * WHEEL_GAIN;
      const dim = el.clientWidth;
      const maxBand = Math.max(48, dim * MAX_BAND_FRAC);
      s.x = rubberBand(next, -maxBand, maxBand, maxBand, RUBBER);
      if (Math.abs(s.x) > 0.5) handled = true;
      else s.x = 0;
    }
  }

  if (handled) {
    if (e.cancelable) e.preventDefault();
    applyTransform(el, s);
    s.velY = 0;
    s.velX = 0;
    if (s.wheelTimer != null) window.clearTimeout(s.wheelTimer);
    s.wheelTimer = window.setTimeout(() => {
      s.wheelTimer = null;
      settle(el, s);
    }, 80);
  }
}

/**
 * Attach bounce listeners to a scroll container (idempotent).
 */
export function enhanceFluidBounce(el: HTMLElement): void {
  if (ENHANCED.has(el)) return;
  ENHANCED.add(el);
  el.classList.add('fluid-bounce-scroll');

  const touchStart = (e: TouchEvent) => onTouchStart(el, e);
  const touchMove = (e: TouchEvent) => onTouchMove(el, e);
  const touchEnd = (e: TouchEvent) => onTouchEnd(el, e);
  const wheel = (e: WheelEvent) => onWheel(el, e);

  el.addEventListener('touchstart', touchStart, { passive: true, capture: false });
  el.addEventListener('touchmove', touchMove, { passive: false, capture: false });
  el.addEventListener('touchend', touchEnd, { passive: true, capture: false });
  el.addEventListener('touchcancel', touchEnd, { passive: true, capture: false });
  el.addEventListener('wheel', wheel, { passive: false, capture: false });
}

function tryEnhance(target: EventTarget | null) {
  const y = findScrollParent(target, 'y');
  if (y) enhanceFluidBounce(y);
  const x = findScrollParent(target, 'x');
  if (x && x !== y) enhanceFluidBounce(x);
}

const SCROLL_SELECTOR = [
  '.custom-scrollbar',
  '.calc-expression-scroll',
  '.invoice-receipt-stage',
  '.pos-dashboard-hub-blur-target',
  '.auth-screen--scrollable',
  '.auth-card-mode--scroll',
  '.vision-hub-click-list',
  '.vision-hub-date-drawer',
  '.fluid-bounce-scroll',
  '[data-native-scroll]',
  '[data-fluid-scroll]',
].join(',');

function scanAndEnhance(root: ParentNode = document) {
  root.querySelectorAll?.(SCROLL_SELECTOR).forEach((node) => {
    if (node instanceof HTMLElement) {
      const st = getComputedStyle(node);
      if (
        overflowAllows(st, 'y') ||
        overflowAllows(st, 'x') ||
        node.classList.contains('fluid-bounce-scroll')
      ) {
        enhanceFluidBounce(node);
      }
    }
  });
  // Also any overflow auto/scroll with actual overflow
  root.querySelectorAll?.('*').forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    if (ENHANCED.has(node)) return;
    // Skip huge walks on full document for * — only when subtree is small
  });
}

/**
 * Install global fluid bounce: auto-enhance known scrollers + on first interaction.
 * Call once at app boot. Returns disposer.
 */
export function installFluidBounceScroll(): () => void {
  const onPointerDown = (e: PointerEvent) => tryEnhance(e.target);
  const onWheelCapture = (e: WheelEvent) => tryEnhance(e.target);
  const onTouchStartCapture = (e: TouchEvent) => tryEnhance(e.target);

  document.addEventListener('pointerdown', onPointerDown, {
    capture: true,
    passive: true,
  });
  document.addEventListener('wheel', onWheelCapture, {
    capture: true,
    passive: true,
  });
  document.addEventListener('touchstart', onTouchStartCapture, {
    capture: true,
    passive: true,
  });

  // Initial + dynamic DOM (modals, drawers)
  scanAndEnhance();
  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((n) => {
        if (n instanceof HTMLElement) {
          if (n.matches?.(SCROLL_SELECTOR)) enhanceFluidBounce(n);
          scanAndEnhance(n);
        }
      });
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // Periodic light rescan for content that grows into scrollability
  const interval = window.setInterval(() => scanAndEnhance(), 2500);

  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('wheel', onWheelCapture, true);
    document.removeEventListener('touchstart', onTouchStartCapture, true);
    mo.disconnect();
    window.clearInterval(interval);
  };
}
