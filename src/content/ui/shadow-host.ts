import { HOST_ELEMENT_ID } from '@/shared/constants';
import { CONTENT_STYLES } from '@/content/ui/styles';
import { el } from '@/content/ui/dom';
import type { ThemePreference } from '@/types';

/**
 * The single injected element.
 *
 * A closed Shadow DOM gives us two guarantees the spec asks for: page CSS
 * cannot style our UI, and our CSS cannot leak onto the page. The host itself
 * is neutralised with `all: initial !important` so even aggressive resets
 * (`* { position: static !important }`) cannot move it.
 */
export interface ShadowHost {
  /** The `.cw-root` container that components attach to. */
  root: HTMLElement;
  setTheme(preference: ThemePreference): void;
  destroy(): void;
}

const HOST_STYLES: Record<string, string> = {
  all: 'initial',
  position: 'fixed',
  top: '0',
  left: '0',
  width: '0',
  height: '0',
  margin: '0',
  padding: '0',
  border: '0',
  'z-index': '2147483647',
  'color-scheme': 'light dark',
};

export function createShadowHost(): ShadowHost {
  document.getElementById(HOST_ELEMENT_ID)?.remove();

  // A custom tag name cannot be hit by page rules like `div { ... }`.
  const host = document.createElement('clariword-root');
  host.id = HOST_ELEMENT_ID;
  for (const [property, value] of Object.entries(HOST_STYLES)) {
    host.style.setProperty(property, value, 'important');
  }

  // Closed in production so page scripts cannot reach into our UI; open in
  // development builds so end-to-end tests can drive it.
  const shadow = host.attachShadow({ mode: __DEV__ ? 'open' : 'closed' });
  const style = document.createElement('style');
  style.textContent = CONTENT_STYLES;
  const root = el('div', { class: 'cw-root' });
  shadow.append(style, root);

  // documentElement rather than body: some sites replace <body> wholesale.
  document.documentElement.append(host);

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let preference: ThemePreference = 'system';

  const apply = (): void => {
    const dark = preference === 'dark' || (preference === 'system' && media.matches);
    root.dataset.theme = dark ? 'dark' : 'light';
  };
  const onMediaChange = (): void => {
    if (preference === 'system') apply();
  };
  media.addEventListener('change', onMediaChange);
  apply();

  return {
    root,
    setTheme(next) {
      preference = next;
      apply();
    },
    destroy() {
      media.removeEventListener('change', onMediaChange);
      host.remove();
    },
  };
}
