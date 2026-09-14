import { HOST_ELEMENT_ID } from '@/shared/constants';
import { normalizeWhitespace } from '@/shared/text';

/**
 * Watches the page for text selections.
 *
 * Performance notes: no MutationObserver, no polling. We listen to a handful
 * of passive events and do the (cheap) range measurement only after the user
 * has stopped changing the selection.
 */

export interface SelectionSnapshot {
  text: string;
  /** Viewport-relative bounding box of the selection. */
  rect: DOMRect;
  range: Range | null;
  /** Set when the selection lives inside an <input> or <textarea>. */
  field: HTMLInputElement | HTMLTextAreaElement | null;
}

const SETTLE_MS = 140;
const MIN_CHARS = 1;

export class SelectionManager {
  private timer: number | null = null;
  private last = '';
  private disposed = false;
  private readonly abort = new AbortController();

  constructor(
    private readonly onSelect: (snapshot: SelectionSnapshot) => void,
    private readonly onClear: () => void,
  ) {}

  start(): void {
    const options = { passive: true, signal: this.abort.signal } as const;
    document.addEventListener('mouseup', this.schedule, options);
    document.addEventListener('touchend', this.schedule, options);
    document.addEventListener('keyup', this.onKeyUp, options);
    document.addEventListener('selectionchange', this.onSelectionChange, options);
  }

  dispose(): void {
    this.disposed = true;
    this.abort.abort();
    if (this.timer !== null) clearTimeout(this.timer);
  }

  /** Read the current selection immediately (used by the context menu path). */
  read(): SelectionSnapshot | null {
    return readSelection();
  }

  private onKeyUp = (event: KeyboardEvent): void => {
    // Shift+arrow / Ctrl+A style keyboard selection.
    if (event.shiftKey || event.key === 'a' || event.key === 'A') this.schedule();
  };

  private onSelectionChange = (): void => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      if (this.last) {
        this.last = '';
        this.onClear();
      }
    }
  };

  private schedule = (): void => {
    if (this.disposed) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = window.setTimeout(this.evaluate, SETTLE_MS);
  };

  private evaluate = (): void => {
    this.timer = null;
    const snapshot = readSelection();
    if (!snapshot) {
      if (this.last) {
        this.last = '';
        this.onClear();
      }
      return;
    }
    if (snapshot.text === this.last) return;
    this.last = snapshot.text;
    this.onSelect(snapshot);
  };
}

/** True when the node sits inside ClariWord's own injected UI. */
function isInsideOwnUi(node: Node | null): boolean {
  let current: Node | null = node;
  while (current) {
    if (current instanceof Element && current.id === HOST_ELEMENT_ID) return true;
    current = current.parentNode ?? (current as ShadowRoot).host ?? null;
  }
  return false;
}

function isEditableField(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) {
    return ['text', 'search', 'url', 'email', ''].includes(element.type);
  }
  return false;
}

export function readSelection(): SelectionSnapshot | null {
  const active = document.activeElement;
  if (isEditableField(active)) {
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? 0;
    const text = normalizeWhitespace(active.value.slice(start, end));
    if (text.length < MIN_CHARS) return null;
    return { text, rect: active.getBoundingClientRect(), range: null, field: active };
  }

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (isInsideOwnUi(range.commonAncestorContainer)) return null;

  const text = normalizeWhitespace(selection.toString());
  if (text.length < MIN_CHARS) return null;

  const rect = bestRect(range);
  if (!rect) return null;
  return { text, rect, range: range.cloneRange(), field: null };
}

/**
 * Prefer the last client rect (where the user's cursor finished) but fall back
 * to the overall bounding box for single-line selections.
 */
function bestRect(range: Range): DOMRect | null {
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
  if (rects.length === 0) {
    const bounding = range.getBoundingClientRect();
    return bounding.width || bounding.height ? bounding : null;
  }
  if (rects.length === 1) return rects[0] as DOMRect;

  const bounding = range.getBoundingClientRect();
  const last = rects[rects.length - 1] as DOMRect;
  // Anchor horizontally to the final line, vertically to the whole selection.
  return new DOMRect(last.left, bounding.top, last.width, bounding.bottom - bounding.top);
}
