import { extractContext } from '@/content/context-extractor';
import { detectHeaderHeight, isVisible, toBox, viewportSize } from '@/content/positioning';
import { SelectionManager, readSelection, type SelectionSnapshot } from '@/content/selection-manager';
import { ExplanationCard, type CardAction } from '@/content/ui/explanation-card';
import { FloatingTrigger } from '@/content/ui/floating-trigger';
import { QuickToolbar, type QuickAction } from '@/content/ui/quick-toolbar';
import { createShadowHost, type ShadowHost } from '@/content/ui/shadow-host';
import { speechService } from '@/services/speech-service';
import { HOST_ELEMENT_ID } from '@/shared/constants';
import { ClariError } from '@/shared/errors';
import { registerHandlers, sendMessage, type TabMessageMap } from '@/shared/messaging';
import { classifySelection, normalizeWhitespace } from '@/shared/text';
import type { ChatMessage, Explanation, ExplainIntent, PageContext, Settings } from '@/types';

/**
 * Content-script controller.
 *
 * Owns the injected UI and the selection lifecycle; performs no network I/O
 * and holds no secrets — every AI call is a message to the service worker.
 */

interface Session {
  context: PageContext;
  kind: ReturnType<typeof classifySelection>;
  explanation: Explanation | null;
  history: ChatMessage[];
  saved: boolean;
  encounterCount: number;
  requestId: number;
}

let settings: Settings | null = null;
let host: ShadowHost | null = null;
let trigger: FloatingTrigger | null = null;
let toolbar: QuickToolbar | null = null;
let card: ExplanationCard | null = null;
let selectionManager: SelectionManager | null = null;
let session: Session | null = null;
let lastSnapshot: SelectionSnapshot | null = null;
let headerHeight = 0;
let requestCounter = 0;
let viewportListenersAttached = false;
let rafHandle = 0;

/* ------------------------------------------------------------------ */
/* Bootstrap                                                           */
/* ------------------------------------------------------------------ */

void bootstrap();

async function bootstrap(): Promise<void> {
  // Never run inside our own extension pages or a nested ClariWord frame.
  if (window.top !== window.self && location.href.startsWith('chrome-extension://')) return;
  if (document.getElementById(HOST_ELEMENT_ID)) return;

  try {
    settings = await sendMessage('GET_SETTINGS');
  } catch {
    // The worker may be starting up; fall back to a passive state and let the
    // SETTINGS_CHANGED broadcast wake us.
    settings = null;
  }

  registerHandlers<TabMessageMap>({
    async EXPLAIN_SELECTION({ intent, selectionText }) {
      await handleExternalRequest(intent, selectionText);
      return { handled: true };
    },
    async SPEAK_SELECTION({ selectionText }) {
      const snapshot = readSelection();
      const text = normalizeWhitespace(selectionText ?? snapshot?.text ?? '');
      if (text) await speak(text);
      return { handled: !!text };
    },
    async SAVE_SELECTION({ selectionText }) {
      await handleExternalRequest('explain', selectionText, { autoSave: true });
      return { handled: true };
    },
    async EXPLANATION_PARTIAL({ requestId, partial }) {
      // Ignore anything from a lookup the reader has already moved past.
      if (!session || !card || session.requestId !== requestId) return { handled: false };
      card.setPartial({
        partial: partial as Parameters<typeof card.setPartial>[0]['partial'],
        selectedText: session.context.selectedText,
      });
      return { handled: true };
    },

    async SETTINGS_CHANGED({ settings: next }) {
      settings = next;
      host?.setTheme(next.theme);
      if (!isEnabled()) teardownUi();
      return { handled: true };
    },
  });

  if (!isEnabled()) return;
  ensureUi();
}

function isEnabled(): boolean {
  if (!settings?.enabled) return false;
  const domain = location.hostname.replace(/^www\./, '');
  return !settings.disabledDomains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

function ensureUi(): void {
  if (host) return;
  host = createShadowHost();
  host.setTheme(settings?.theme ?? 'system');

  trigger = new FloatingTrigger(host.root, () => void openFromSelection('explain'));
  toolbar = new QuickToolbar(host.root, (action) => void onQuickAction(action));
  card = new ExplanationCard(host.root, {
    onClose: closeCard,
    onAction: (action) => void onCardAction(action),
    onAsk: (question) => ask(question),
    onVocabularyClick: (word) => void explainWord(word),
    onRetry: () => void requestExplanation('explain'),
  });

  selectionManager = new SelectionManager(onSelection, onSelectionCleared);
  selectionManager.start();

  document.addEventListener('mousedown', onDocumentPointerDown, true);
  document.addEventListener('keydown', onDocumentKeyDown, true);
}

function teardownUi(): void {
  selectionManager?.dispose();
  selectionManager = null;
  card?.close();
  trigger?.hide();
  toolbar?.hide();
  host?.destroy();
  host = null;
  card = null;
  trigger = null;
  toolbar = null;
  session = null;
  detachViewportListeners();
  document.removeEventListener('mousedown', onDocumentPointerDown, true);
  document.removeEventListener('keydown', onDocumentKeyDown, true);
}

/* ------------------------------------------------------------------ */
/* Selection lifecycle                                                 */
/* ------------------------------------------------------------------ */

function onSelection(snapshot: SelectionSnapshot): void {
  lastSnapshot = snapshot;
  if (!settings?.autoHelper || card?.visible) return;
  headerHeight = detectHeaderHeight();
  const anchor = toBox(snapshot.rect);
  if (settings.helperMode === 'toolbar') {
    trigger?.hide();
    toolbar?.show(anchor, headerHeight);
  } else {
    toolbar?.hide();
    trigger?.show(anchor, headerHeight);
  }
  attachViewportListeners();
}

function onSelectionCleared(): void {
  if (card?.visible) return;
  trigger?.hide();
  toolbar?.hide();
  detachViewportListeners();
}

function onQuickAction(action: QuickAction): void {
  switch (action) {
    case 'explain':
      void openFromSelection('explain');
      break;
    case 'simplify':
      void openFromSelection('simplify');
      break;
    case 'examples':
      void openFromSelection('examples');
      break;
    case 'pronounce':
      void speak(lastSnapshot?.text ?? '');
      break;
    case 'save':
      void openFromSelection('explain', { autoSave: true });
      break;
  }
}

async function handleExternalRequest(
  intent: ExplainIntent,
  selectionText?: string,
  options: { autoSave?: boolean } = {},
): Promise<void> {
  if (!isEnabled()) return;
  ensureUi();
  const snapshot = readSelection();
  if (snapshot) {
    lastSnapshot = snapshot;
  } else if (selectionText) {
    // Context-menu path where the live selection was lost: anchor centrally.
    const { width, height } = viewportSize();
    lastSnapshot = {
      text: normalizeWhitespace(selectionText),
      rect: new DOMRect(width / 2 - 40, height / 3, 80, 20),
      range: null,
      field: null,
    };
  }
  await openFromSelection(intent, options);
}

/* ------------------------------------------------------------------ */
/* Explanation flow                                                    */
/* ------------------------------------------------------------------ */

async function openFromSelection(intent: ExplainIntent, options: { autoSave?: boolean } = {}): Promise<void> {
  const snapshot = lastSnapshot ?? readSelection();
  if (!snapshot || !snapshot.text) return;
  lastSnapshot = snapshot;

  trigger?.hide();
  toolbar?.hide();

  const context = extractContext(snapshot);
  session = {
    context,
    kind: classifySelection(context.selectedText),
    explanation: null,
    history: [],
    saved: false,
    encounterCount: 0,
    requestId: 0,
  };

  headerHeight = detectHeaderHeight();
  card?.open(toBox(snapshot.rect), headerHeight);
  card?.setLoading(context.selectedText, loadingMessageFor(session.kind));
  attachViewportListeners();

  await requestExplanation(intent, options);
}

function loadingMessageFor(kind: Session['kind']): string {
  switch (kind) {
    case 'word':
      return 'Understanding this in context…';
    case 'phrase':
      return 'Reading this phrase as a unit…';
    case 'sentence':
      return 'Breaking this sentence down…';
    case 'passage':
      return 'Summarising this passage…';
  }
}

async function requestExplanation(intent: ExplainIntent, options: { autoSave?: boolean } = {}): Promise<void> {
  if (!session || !settings || !card) return;
  const requestId = (requestCounter += 1);
  session.requestId = requestId;
  card.setLoading(session.context.selectedText, loadingMessageFor(session.kind));

  try {
    const [response, status] = await Promise.all([
      sendMessage('EXPLAIN', {
        context: session.context,
        kind: session.kind,
        explanationLevel: settings.explanationLevel,
        accent: settings.accent,
        intent,
        requestId,
      }),
      sendMessage('TERM_STATUS', { text: session.context.selectedText }).catch(() => ({
        saved: false,
        entryId: null,
        encounterCount: 0,
      })),
    ]);

    // A newer request superseded this one while it was in flight.
    if (!session || session.requestId !== requestId) return;

    session.explanation = response.explanation;
    session.saved = status.saved;
    session.encounterCount = status.encounterCount;

    card.setContent({
      explanation: response.explanation,
      meta: response.meta,
      selectedText: session.context.selectedText,
      saved: status.saved,
      encounterCount: status.encounterCount,
    });

    if (status.saved) void sendMessage('RECORD_ENCOUNTER', newVocabularyInput()).catch(() => undefined);
    if (options.autoSave && !status.saved) await saveCurrent();
    if (settings.autoPlayPronunciation && session.kind === 'word') {
      void speak(session.context.selectedText);
    }
  } catch (error) {
    if (!session || session.requestId !== requestId) return;
    card.setError(ClariError.from(error).toJSON());
  }
}

async function explainWord(word: string): Promise<void> {
  if (!session || !card) return;
  const context: PageContext = { ...session.context, selectedText: normalizeWhitespace(word) };
  session = { ...session, context, kind: 'word', explanation: null, history: [] };
  await requestExplanation('explain');
}

/** Re-explain the sentence the current word came from. */
async function explainContainingSentence(): Promise<void> {
  if (!session || !card) return;
  const sentence = session.context.sentence || session.context.selectedText;
  if (!sentence || sentence === session.context.selectedText) return;
  const context: PageContext = { ...session.context, selectedText: sentence };
  session = { ...session, context, kind: 'sentence', explanation: null, history: [] };
  await requestExplanation('explain');
}

function newVocabularyInput() {
  if (!session || !settings) throw new ClariError('UNKNOWN', 'No active selection.');
  return {
    context: session.context,
    kind: session.kind,
    explanation: session.explanation,
    saveSourcePage: settings.saveSourcePage,
  };
}

async function saveCurrent(): Promise<void> {
  if (!session || !card) return;
  try {
    const result = await sendMessage('SAVE_ENTRY', newVocabularyInput());
    session.saved = true;
    session.encounterCount = result.entry.encounterCount;
    card.markSaved(true);
  } catch (error) {
    card.setError(ClariError.from(error).toJSON());
  }
}

/* ------------------------------------------------------------------ */
/* Card actions                                                        */
/* ------------------------------------------------------------------ */

const FOLLOW_UP_QUESTIONS: Partial<Record<CardAction, string>> = {
  simplify: 'Explain this more simply, as if to a beginner.',
  'why-this-word': 'Why did the author choose this word here? What does it suggest?',
  'why-this-wording': 'Why did the author phrase it this way? What does the wording suggest?',
  examples: 'Give me two more natural example sentences using this.',
  grammar: 'Explain the grammar of this, briefly.',
  'key-vocabulary': 'Which words here are worth learning, and what does each one mean?',
};

async function onCardAction(action: CardAction): Promise<void> {
  if (!session) return;
  switch (action) {
    case 'save':
      if (session.saved) {
        await sendMessage('OPEN_PAGE', { page: 'vocabulary' });
      } else {
        await saveCurrent();
      }
      return;
    case 'pronounce':
      await speak(card?.currentSpeakText || session.context.selectedText);
      return;
    case 'read-aloud':
      await speak(session.context.selectedText);
      return;
    case 'explain-sentence':
      await explainContainingSentence();
      return;
    case 'practice':
      await sendMessage('OPEN_PAGE', {
        page: 'practice',
        query: { word: session.context.selectedText },
      });
      return;
    default: {
      const question = FOLLOW_UP_QUESTIONS[action];
      if (question) await ask(question);
    }
  }
}

async function ask(question: string): Promise<void> {
  if (!session || !settings || !card) return;
  const message: ChatMessage = { role: 'user', content: question, at: Date.now() };
  session.history.push(message);
  card.appendChatMessage(message);
  card.setChatBusy(true);

  try {
    const response = await sendMessage('CHAT', {
      context: session.context,
      explanation: session.explanation,
      history: session.history,
      question,
      explanationLevel: settings.explanationLevel,
      accent: settings.accent,
    });
    const reply: ChatMessage = { role: 'assistant', content: response.answer, at: Date.now() };
    session.history.push(reply);
    card.setChatBusy(false);
    card.appendChatMessage(reply);
  } catch (error) {
    card.setChatBusy(false);
    const clari = ClariError.from(error);
    card.appendChatMessage({
      role: 'assistant',
      content: `${clari.message}${clari.hint ? `\n${clari.hint}` : ''}`,
      at: Date.now(),
    });
  }
}

async function speak(text: string): Promise<void> {
  const trimmed = normalizeWhitespace(text);
  if (!trimmed) return;
  if (speechService.state === 'speaking') {
    speechService.cancel();
    card?.setSpeaking(false);
    return;
  }
  try {
    await speechService.speak(trimmed, {
      accent: settings?.accent ?? 'american',
      rate: settings?.ttsRate ?? 0.95,
      voiceUri: settings?.ttsVoiceUri ?? '',
      onStateChange: (state) => card?.setSpeaking(state === 'speaking'),
    });
  } catch (error) {
    card?.setError(ClariError.from(error).toJSON());
  }
}

/* ------------------------------------------------------------------ */
/* Dismissal + viewport                                                */
/* ------------------------------------------------------------------ */

function closeCard(): void {
  speechService.cancel();
  card?.close();
  trigger?.hide();
  toolbar?.hide();
  session = null;
  detachViewportListeners();
}

function onDocumentPointerDown(event: MouseEvent): void {
  if (!card?.visible && !trigger?.visible && !toolbar?.visible) return;
  // composedPath crosses the shadow boundary, so this works whether the root
  // is open (dev) or closed (production, where the path stops at the host).
  const insideOwnUi = event
    .composedPath()
    .some((node) => node instanceof Element && node.id === HOST_ELEMENT_ID);
  if (insideOwnUi) return;
  if (card?.visible) closeCard();
  else {
    trigger?.hide();
    toolbar?.hide();
  }
}

function onDocumentKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  if (card?.visible) {
    event.stopPropagation();
    closeCard();
  } else if (trigger?.visible || toolbar?.visible) {
    trigger?.hide();
    toolbar?.hide();
  }
}

function attachViewportListeners(): void {
  if (viewportListenersAttached) return;
  viewportListenersAttached = true;
  window.addEventListener('scroll', onViewportChange, { passive: true, capture: true });
  window.addEventListener('resize', onViewportChange, { passive: true });
}

function detachViewportListeners(): void {
  if (!viewportListenersAttached) return;
  viewportListenersAttached = false;
  window.removeEventListener('scroll', onViewportChange, true);
  window.removeEventListener('resize', onViewportChange);
  if (rafHandle) cancelAnimationFrame(rafHandle);
  rafHandle = 0;
}

/** rAF-throttled: at most one measurement per frame, and only while open. */
function onViewportChange(): void {
  if (rafHandle) return;
  rafHandle = requestAnimationFrame(() => {
    rafHandle = 0;
    headerHeight = detectHeaderHeight();

    if (card?.visible) {
      card.reposition();
      return;
    }
    const snapshot = readSelection();
    if (!snapshot) {
      trigger?.hide();
      toolbar?.hide();
      detachViewportListeners();
      return;
    }
    if (!isVisible(toBox(snapshot.rect), viewportSize())) {
      trigger?.hide();
      toolbar?.hide();
      return;
    }
    trigger?.update(snapshot.rect, headerHeight);
    toolbar?.update(snapshot.rect, headerHeight);
  });
}

// Single-page apps swap documents without a reload: drop stale UI on navigation.
window.addEventListener('pagehide', () => {
  speechService.cancel();
  card?.close();
});
