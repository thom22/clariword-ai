import { CONTEXT_MENU_IDS } from '@/shared/constants';
import { sendToTab } from '@/shared/messaging';
import type { ExplainIntent } from '@/types';

const MENU_CONTEXTS: chrome.contextMenus.ContextType[] = ['selection'];

/**
 * Right-click integration. Rebuilt from scratch on install/startup so a stale
 * menu from a previous version can never linger.
 */
export async function installContextMenus(): Promise<void> {
  await removeAll();

  chrome.contextMenus.create({
    id: CONTEXT_MENU_IDS.root,
    title: 'Explain with ClariWord AI',
    contexts: MENU_CONTEXTS,
  });
  chrome.contextMenus.create({
    id: CONTEXT_MENU_IDS.explain,
    parentId: CONTEXT_MENU_IDS.root,
    title: 'Explain in context',
    contexts: MENU_CONTEXTS,
  });
  chrome.contextMenus.create({
    id: CONTEXT_MENU_IDS.simplify,
    parentId: CONTEXT_MENU_IDS.root,
    title: 'Explain more simply',
    contexts: MENU_CONTEXTS,
  });
  chrome.contextMenus.create({
    id: CONTEXT_MENU_IDS.pronounce,
    parentId: CONTEXT_MENU_IDS.root,
    title: 'Pronounce',
    contexts: MENU_CONTEXTS,
  });
  chrome.contextMenus.create({
    id: CONTEXT_MENU_IDS.save,
    parentId: CONTEXT_MENU_IDS.root,
    title: 'Save to my vocabulary',
    contexts: MENU_CONTEXTS,
  });
}

function removeAll(): Promise<void> {
  return new Promise((resolve) => chrome.contextMenus.removeAll(() => resolve()));
}

const INTENT_BY_MENU: Record<string, ExplainIntent> = {
  [CONTEXT_MENU_IDS.root]: 'explain',
  [CONTEXT_MENU_IDS.explain]: 'explain',
  [CONTEXT_MENU_IDS.simplify]: 'simplify',
};

export function registerContextMenuHandler(): void {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;
    const selectionText = info.selectionText?.trim() || undefined;

    if (info.menuItemId === CONTEXT_MENU_IDS.pronounce) {
      void sendToTab(tab.id, 'SPEAK_SELECTION', { selectionText });
      return;
    }
    if (info.menuItemId === CONTEXT_MENU_IDS.save) {
      void sendToTab(tab.id, 'SAVE_SELECTION', { selectionText });
      return;
    }
    const intent = INTENT_BY_MENU[String(info.menuItemId)];
    if (!intent) return;
    void sendToTab(tab.id, 'EXPLAIN_SELECTION', { intent, selectionText });
  });
}
