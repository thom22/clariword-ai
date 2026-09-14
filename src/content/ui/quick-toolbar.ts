import { el, svg } from '@/content/ui/dom';
import { ICONS } from '@/content/ui/icons';
import { place, toBox, viewportSize, type Box } from '@/content/positioning';

export type QuickAction = 'explain' | 'simplify' | 'pronounce' | 'examples' | 'save';

interface ActionSpec {
  id: QuickAction;
  label: string;
  icon: string;
}

/** Five actions, no more: the spec explicitly warns against button soup. */
const ACTIONS: ActionSpec[] = [
  { id: 'explain', label: 'Explain', icon: ICONS.spark },
  { id: 'simplify', label: 'Simplify', icon: ICONS.book },
  { id: 'pronounce', label: 'Pronounce', icon: ICONS.speaker },
  { id: 'examples', label: 'Examples', icon: ICONS.chevron },
  { id: 'save', label: 'Save', icon: ICONS.bookmarkOutline },
];

export class QuickToolbar {
  private node: HTMLElement | null = null;
  private anchor: Box | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly onAction: (action: QuickAction) => void,
  ) {}

  show(anchor: Box, headerHeight: number): void {
    this.anchor = anchor;
    if (!this.node) {
      const buttons: (HTMLElement | null)[] = [];
      ACTIONS.forEach((action, index) => {
        if (index === ACTIONS.length - 1) buttons.push(el('span', { class: 'cw-sep' }));
        buttons.push(
          el(
            'button',
            {
              class: '',
              attrs: { type: 'button', 'data-action': action.id, 'aria-label': action.label },
              on: {
                mousedown: (event) => event.preventDefault(),
                click: () => this.onAction(action.id),
              },
            },
            [svg(action.icon), action.label],
          ),
        );
      });
      this.node = el('div', { class: 'cw-toolbar', attrs: { role: 'toolbar', 'aria-label': 'ClariWord quick actions' } }, buttons);
      this.container.append(this.node);
    }
    this.reposition(headerHeight);
  }

  reposition(headerHeight: number): void {
    if (!this.node || !this.anchor) return;
    const size = { width: this.node.offsetWidth || 320, height: this.node.offsetHeight || 38 };
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
