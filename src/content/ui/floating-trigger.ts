import { el } from '@/content/ui/dom';
import { place, toBox, viewportSize, type Box } from '@/content/positioning';
import { APP_NAME } from '@/shared/constants';

/**
 * The small pill that appears next to a selection. Deliberately one target:
 * the full toolbar is an opt-in setting, not the default.
 */
export class FloatingTrigger {
  private node: HTMLButtonElement | null = null;
  private anchor: Box | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly onActivate: () => void,
  ) {}

  show(anchor: Box, headerHeight: number): void {
    this.anchor = anchor;
    if (!this.node) {
      this.node = el(
        'button',
        {
          class: 'cw-trigger',
          attrs: { type: 'button', 'aria-label': `Explain selection with ${APP_NAME}` },
          on: {
            mousedown: (event) => event.preventDefault(),
            click: () => this.onActivate(),
          },
        },
        [el('span', { class: 'cw-mark', text: 'C', attrs: { 'aria-hidden': 'true' } }), 'Explain'],
      );
      this.container.append(this.node);
    }
    this.reposition(headerHeight);
  }

  reposition(headerHeight: number): void {
    if (!this.node || !this.anchor) return;
    const size = { width: this.node.offsetWidth || 96, height: this.node.offsetHeight || 32 };
    const { top, left } = place(this.anchor, size, viewportSize(), { gap: 8, headerHeight });
    this.node.style.top = `${Math.round(top)}px`;
    this.node.style.left = `${Math.round(left)}px`;
  }

  update(anchor: DOMRect, headerHeight: number): void {
    this.anchor = toBox(anchor);
    this.reposition(headerHeight);
  }

  hide(): void {
    this.node?.remove();
    this.node = null;
    this.anchor = null;
  }

  get visible(): boolean {
    return this.node !== null;
  }
}
