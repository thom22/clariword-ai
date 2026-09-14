/**
 * Viewport-aware placement for the floating trigger and the explanation card.
 *
 * Pure functions so the edge cases (top of page, bottom of page, narrow
 * windows, fixed site headers) are unit-testable without a browser.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type Placement = 'below' | 'above';

export interface PlacementResult {
  top: number;
  left: number;
  placement: Placement;
}

export interface PlaceOptions {
  /** Gap between the selection and the floating element. */
  gap?: number;
  /** Keep-out margin from the viewport edges. */
  margin?: number;
  /**
   * Height of any fixed site header. Anything placed above the selection is
   * pushed below this line so sticky navbars cannot cover the card.
   */
  headerHeight?: number;
  prefer?: Placement;
}

export function place(anchor: Box, size: Size, viewport: Size, options: PlaceOptions = {}): PlacementResult {
  const gap = options.gap ?? 8;
  const margin = options.margin ?? 8;
  const headerHeight = options.headerHeight ?? 0;
  const prefer = options.prefer ?? 'below';

  const spaceBelow = viewport.height - (anchor.top + anchor.height) - gap - margin;
  const spaceAbove = anchor.top - gap - margin - headerHeight;

  let placement: Placement = prefer;
  if (prefer === 'below' && spaceBelow < size.height && spaceAbove > spaceBelow) placement = 'above';
  if (prefer === 'above' && spaceAbove < size.height && spaceBelow > spaceAbove) placement = 'below';

  let top =
    placement === 'below' ? anchor.top + anchor.height + gap : anchor.top - size.height - gap;

  // Clamp vertically: never above the header, never past the bottom edge.
  const minTop = margin + headerHeight;
  const maxTop = Math.max(minTop, viewport.height - size.height - margin);
  top = Math.min(Math.max(top, minTop), maxTop);

  // Centre on the selection, then clamp horizontally.
  let left = anchor.left + anchor.width / 2 - size.width / 2;
  const maxLeft = Math.max(margin, viewport.width - size.width - margin);
  left = Math.min(Math.max(left, margin), maxLeft);

  return { top, left, placement };
}

/**
 * Best-effort detection of a sticky/fixed site header so we do not park the
 * card underneath one. Cheap: samples three points across the top of the page.
 */
export function detectHeaderHeight(doc: Document = document): number {
  const width = doc.documentElement.clientWidth;
  const samples = [width * 0.2, width * 0.5, width * 0.8];
  let height = 0;

  for (const x of samples) {
    const element = doc.elementFromPoint(Math.round(x), 4);
    let current: Element | null = element;
    while (current && current !== doc.body && current !== doc.documentElement) {
      const style = getComputedStyle(current);
      if (style.position === 'fixed' || style.position === 'sticky') {
        const rect = current.getBoundingClientRect();
        if (rect.top <= 2 && rect.height > 0 && rect.height < 240) {
          height = Math.max(height, rect.bottom);
        }
        break;
      }
      current = current.parentElement;
    }
  }
  return height;
}

/** True when the anchor is at least partly on screen. */
export function isVisible(anchor: Box, viewport: Size): boolean {
  return anchor.top + anchor.height > 0 && anchor.top < viewport.height;
}

export function viewportSize(): Size {
  return {
    width: document.documentElement.clientWidth || window.innerWidth,
    height: document.documentElement.clientHeight || window.innerHeight,
  };
}

export function toBox(rect: DOMRect | Box): Box {
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}
