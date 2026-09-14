import { installContextMenus, registerContextMenuHandler } from '@/background/context-menus';
import { aiService } from '@/services/ai-service';
import { runMigrations } from '@/services/migrations';
import { settingsService } from '@/services/settings-service';
import { statsService } from '@/services/stats-service';
import { buildReviewQuestions, vocabularyRepository } from '@/services/vocabulary-service';
import { BRAND } from '@/shared/constants';
import { registerHandlers, sendToTab, type ExtensionPage, type MessageMap } from '@/shared/messaging';
import type { Settings } from '@/types';

/**
 * The service worker is the extension's trusted core:
 *  - it is the only context that talks to the AI backend,
 *  - it owns all persistence, so writes are serialised in one place,
 *  - it brokers the context menu and keyboard commands.
 *
 * MV3 workers are torn down when idle, so everything here is either
 * event-driven or lazily rebuilt from storage.
 */

const PAGE_URLS: Record<ExtensionPage, string> = {
  vocabulary: 'vocabulary/vocabulary.html',
  options: 'options/options.html',
  review: 'review/review.html',
  practice: 'practice/practice.html',
};

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    await runMigrations();
    await installContextMenus();
    await refreshBadge();
    if (details.reason === 'install') {
      await chrome.tabs.create({ url: chrome.runtime.getURL(`${PAGE_URLS.options}?welcome=1`) });
    }
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await installContextMenus();
    await refreshBadge();
  })();
});

registerContextMenuHandler();

chrome.commands?.onCommand.addListener((command) => {
  void (async () => {
    if (command === 'open-vocabulary') {
      await openPage('vocabulary');
      return;
    }
    if (command === 'explain-selection') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) await sendToTab(tab.id, 'EXPLAIN_SELECTION', { intent: 'explain' });
    }
  })();
});

/** Broadcast settings changes so open tabs update without a reload. */
settingsService.onChange((settings) => {
  void broadcastSettings(settings);
  void refreshBadge();
});

/* ------------------------------------------------------------------ */
/* Message handlers                                                    */
/* ------------------------------------------------------------------ */

registerHandlers<MessageMap>({
  async PING() {
    return { ok: true, version: __VERSION__ };
  },

  async EXPLAIN(request) {
    const settings = await settingsService.get();
    const response = await aiService.explain(request, settings);
    if (!response.meta.cached) void statsService.increment('lookups');
    return response;
  },

  async CHAT(request) {
    const settings = await settingsService.get();
    return aiService.chat(request, settings);
  },

  async GET_SETTINGS() {
    return settingsService.get();
  },

  async UPDATE_SETTINGS(patch) {
    const settings = await settingsService.update(patch);
    // Changing level/accent/mode invalidates cached explanations.
    aiService.clearCache();
    return settings;
  },

  async GET_STATS() {
    return statsService.summary();
  },

  async SAVE_ENTRY(input) {
    const result = await vocabularyRepository.save(input);
    if (result.created) void statsService.increment('saves');
    await refreshBadge();
    return result;
  },

  async LIST_VOCABULARY(query) {
    return vocabularyRepository.list(query);
  },

  async GET_ENTRY({ id }) {
    return vocabularyRepository.get(id);
  },

  async UPDATE_ENTRY({ id, patch }) {
    const entry = await vocabularyRepository.update(id, patch);
    await refreshBadge();
    return entry;
  },

  async DELETE_ENTRY({ id }) {
    const deleted = await vocabularyRepository.remove(id);
    await refreshBadge();
    return { deleted };
  },

  async CLEAR_VOCABULARY() {
    const deleted = await vocabularyRepository.clear();
    await statsService.clear();
    aiService.clearCache();
    await refreshBadge();
    return { deleted };
  },

  async TERM_STATUS({ text }) {
    const entry = await vocabularyRepository.findByText(text);
    return {
      saved: !!entry,
      entryId: entry?.id ?? null,
      encounterCount: entry?.encounterCount ?? 0,
    };
  },

  async RECORD_ENCOUNTER(input) {
    const entry = await vocabularyRepository.recordEncounter(input);
    return {
      saved: !!entry,
      entryId: entry?.id ?? null,
      encounterCount: entry?.encounterCount ?? 0,
    };
  },

  async GET_REVIEW_QUEUE({ limit }) {
    const due = await vocabularyRepository.due();
    const pool = due.length >= 4 ? due : await vocabularyRepository.list({ sort: 'recent' });
    return buildReviewQuestions(pool, limit ?? 10);
  },

  async SUBMIT_REVIEW({ entryId, correct }) {
    const entry = await vocabularyRepository.recordReview(entryId, correct);
    void statsService.increment('reviewsAnswered');
    if (correct) void statsService.increment('reviewsCorrect');
    await refreshBadge();
    return { entry };
  },

  async OPEN_PAGE({ page, query }) {
    await openPage(page, query);
    return { opened: true };
  },
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function openPage(page: ExtensionPage, query?: Record<string, string>): Promise<void> {
  const search = query ? `?${new URLSearchParams(query).toString()}` : '';
  await chrome.tabs.create({ url: chrome.runtime.getURL(`${PAGE_URLS[page]}${search}`) });
}

/** The toolbar badge shows how many saved words are due for review. */
async function refreshBadge(): Promise<void> {
  try {
    const due = await vocabularyRepository.due();
    await chrome.action.setBadgeBackgroundColor({ color: BRAND.accent });
    await chrome.action.setBadgeText({ text: due.length > 0 ? String(Math.min(due.length, 99)) : '' });
  } catch {
    /* badge is cosmetic — never let it break a save */
  }
}

/**
 * Push new settings into every tab. We deliberately do not filter by URL:
 * that would need the broad "tabs" permission, and `sendToTab` already
 * resolves to null for tabs without a ClariWord content script.
 */
async function broadcastSettings(settings: Settings): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map((tab) => (tab.id ? sendToTab(tab.id, 'SETTINGS_CHANGED', { settings }) : Promise.resolve(null))),
  );
}

/** Storage written by another context (e.g. the dashboard) invalidates caches. */
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') vocabularyRepository.invalidate();
});
