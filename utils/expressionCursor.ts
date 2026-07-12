export const getRangeAtCharacterIndex = (root: HTMLElement, index: number): Range | null => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, index);
  let node = walker.nextNode();

  while (node) {
    const len = node.textContent?.length ?? 0;
    if (remaining <= len) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      return range;
    }
    remaining -= len;
    node = walker.nextNode();
  }

  return null;
};

export const mapPointerToExpressionIndex = (
  root: HTMLElement,
  clientX: number,
  clientY: number,
  maxIndex: number,
  fallback: (clientX: number, clientY: number) => number
): number => {
  const doc = root.ownerDocument;

  if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(clientX, clientY);
    if (range && root.contains(range.startContainer)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let offset = 0;
      let node = walker.nextNode();
      while (node) {
        if (node === range.startContainer) {
          return Math.max(0, Math.min(maxIndex, offset + range.startOffset));
        }
        offset += node.textContent?.length ?? 0;
        node = walker.nextNode();
      }
    }
  }

  const caretPositionFromPoint = (
    doc as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    }
  ).caretPositionFromPoint;

  if (typeof caretPositionFromPoint === 'function') {
    const pos = caretPositionFromPoint(clientX, clientY);
    if (pos && root.contains(pos.offsetNode)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let offset = 0;
      let node = walker.nextNode();
      while (node) {
        if (node === pos.offsetNode) {
          return Math.max(0, Math.min(maxIndex, offset + pos.offset));
        }
        offset += node.textContent?.length ?? 0;
        node = walker.nextNode();
      }
    }
  }

  return Math.max(0, Math.min(maxIndex, fallback(clientX, clientY)));
};

const getCursorTargetRect = (
  root: HTMLElement,
  cursorPos: number
): DOMRect | null => {
  const cursorEl = root.querySelector('[data-expression-cursor]');
  if (cursorEl instanceof HTMLElement) {
    return cursorEl.getBoundingClientRect();
  }

  const range = getRangeAtCharacterIndex(root, cursorPos);
  if (!range) return null;
  return range.getBoundingClientRect();
};

export const scrollCursorIntoView = (
  scrollEl: HTMLElement,
  root: HTMLElement,
  cursorPos: number,
  padding = 10
): void => {
  const targetRect = getCursorTargetRect(root, cursorPos);
  if (!targetRect) return;

  const scrollRect = scrollEl.getBoundingClientRect();

  if (targetRect.top < scrollRect.top + padding) {
    scrollEl.scrollTop -= scrollRect.top + padding - targetRect.top;
  } else if (targetRect.bottom > scrollRect.bottom - padding) {
    scrollEl.scrollTop += targetRect.bottom - (scrollRect.bottom - padding);
  }

  if (targetRect.left < scrollRect.left + padding) {
    scrollEl.scrollLeft -= scrollRect.left + padding - targetRect.left;
  } else if (targetRect.right > scrollRect.right - padding) {
    scrollEl.scrollLeft += targetRect.right - (scrollRect.right - padding);
  }
};