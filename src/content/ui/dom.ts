/**
 * Tiny DOM builder.
 *
 * Everything the card renders may contain page text or model output, so this
 * helper only ever assigns `textContent` — there is no innerHTML path for
 * untrusted strings anywhere in the injected UI.
 */

type Attrs = Record<string, string | number | boolean | undefined | null>;

export interface ElOptions {
  class?: string;
  text?: string;
  attrs?: Attrs;
  on?: { [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void };
  title?: string;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
  children: (Node | string | null | undefined | false)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.title) node.title = options.title;

  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const [event, handler] of Object.entries(options.on ?? {})) {
    if (handler) node.addEventListener(event, handler as EventListener);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function svg(path: string, viewBox = '0 0 24 24'): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const root = document.createElementNS(NS, 'svg');
  root.setAttribute('viewBox', viewBox);
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('focusable', 'false');
  const shape = document.createElementNS(NS, 'path');
  shape.setAttribute('d', path);
  root.append(shape);
  return root;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Focusable elements inside a container, for the focus trap. */
export function focusable(root: ParentNode): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((node) => node.offsetParent !== null || node.getClientRects().length > 0);
}
