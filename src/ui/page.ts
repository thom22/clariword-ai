import { sendMessage } from '@/shared/messaging';
import type { Settings, ThemePreference } from '@/types';

/** Helpers shared by the popup, settings, vocabulary, review and practice pages. */

export { el, svg, clear } from '@/content/ui/dom';

export function applyTheme(preference: ThemePreference): void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const resolve = (): void => {
    const dark = preference === 'dark' || (preference === 'system' && media.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  };
  resolve();
  media.onchange = () => {
    if (preference === 'system') resolve();
  };
}

/** Load settings and apply the theme before the first paint of content. */
export async function initPage(): Promise<Settings> {
  const settings = await sendMessage('GET_SETTINGS');
  applyTheme(settings.theme);
  return settings;
}

export function query<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`ClariWord: missing element "${selector}"`);
  return node;
}

export function queryAll<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

let toastTimer = 0;

export function toast(message: string, ms = 2200): void {
  let node = document.querySelector<HTMLElement>('.toast');
  if (!node) {
    node = document.createElement('div');
    node.className = 'toast';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    document.body.append(node);
  }
  node.textContent = message;
  node.dataset.visible = 'true';
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (node) node.dataset.visible = 'false';
  }, ms);
}

/** Wire a `.segmented` group of buttons to a value change. */
export function segmented(root: HTMLElement, value: string, onChange: (next: string) => void): void {
  const buttons = queryAll<HTMLButtonElement>('button', root);
  const render = (current: string): void => {
    for (const button of buttons) {
      button.setAttribute('aria-pressed', button.dataset.value === current ? 'true' : 'false');
    }
  };
  render(value);
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const next = button.dataset.value ?? '';
      render(next);
      onChange(next);
    });
  }
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Renders "os-TEN-suh-blee" with the stressed syllable marked, for pages. */
export function phoneticNodes(phonetic: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const parts = phonetic.split('-');
  parts.forEach((part, index) => {
    const stressed = /^[A-Z]{2,}$/.test(part);
    const span = document.createElement('span');
    if (stressed) span.className = 'stress';
    span.textContent = part;
    fragment.append(span);
    if (index < parts.length - 1) fragment.append(document.createTextNode('-'));
  });
  return fragment;
}
