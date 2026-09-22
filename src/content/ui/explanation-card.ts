import { clear, el, focusable, svg } from '@/content/ui/dom';
import { ICONS } from '@/content/ui/icons';
import { headerInfoFor, renderExplanation, renderPhonetic } from '@/content/ui/card-renderers';
import { place, toBox, viewportSize, type Box } from '@/content/positioning';
import { truncate } from '@/shared/text';
import type { ChatMessage, ClariErrorShape, Explanation, ExplainResponseMeta } from '@/types';

export type CardAction =
  | 'explain-sentence'
  | 'why-this-word'
  | 'why-this-wording'
  | 'pronounce'
  | 'examples'
  | 'grammar'
  | 'simplify'
  | 'key-vocabulary'
  | 'read-aloud'
  | 'practice'
  | 'save';

export interface CardCallbacks {
  onClose(): void;
  onAction(action: CardAction): void;
  onAsk(question: string): Promise<void>;
  onVocabularyClick(word: string): void;
  onRetry(): void;
}

interface ActionSpec {
  id: CardAction;
  label: string;
  icon?: string;
  primary?: boolean;
}

const ACTIONS_BY_TYPE: Record<Explanation['type'], ActionSpec[]> = {
  word: [
    { id: 'explain-sentence', label: 'Explain sentence' },
    { id: 'why-this-word', label: 'Why this word?' },
    { id: 'examples', label: 'Examples' },
    { id: 'grammar', label: 'Grammar' },
    { id: 'practice', label: 'Practice', icon: ICONS.mic },
  ],
  sentence: [
    { id: 'simplify', label: 'Explain simpler' },
    { id: 'grammar', label: 'Grammar' },
    { id: 'key-vocabulary', label: 'Key vocabulary' },
    { id: 'why-this-wording', label: 'Why this wording?' },
    { id: 'read-aloud', label: 'Read aloud', icon: ICONS.speaker },
  ],
  phrase: [
    { id: 'simplify', label: 'Explain simpler' },
    { id: 'examples', label: 'Examples' },
    { id: 'read-aloud', label: 'Read aloud', icon: ICONS.speaker },
  ],
  passage: [
    { id: 'simplify', label: 'Explain simpler' },
    { id: 'key-vocabulary', label: 'Key vocabulary' },
    { id: 'read-aloud', label: 'Read aloud', icon: ICONS.speaker },
  ],
};

/**
 * The explanation card.
 *
 * Opens immediately with a loading state — the spec is explicit that the user
 * should never wait on a blank screen — then swaps in content, an error, or a
 * retry affordance.
 */
export class ExplanationCard {
  private node: HTMLElement | null = null;
  private bodyNode: HTMLElement | null = null;
  private headNode: HTMLElement | null = null;
  private actionsNode: HTMLElement | null = null;
  private chatNode: HTMLElement | null = null;
  private chatLog: HTMLElement | null = null;
  private chatInput: HTMLTextAreaElement | null = null;
  private chatSend: HTMLButtonElement | null = null;
  private saveButton: HTMLButtonElement | null = null;
  private speakButton: HTMLButtonElement | null = null;
  private anchor: Box | null = null;
  private headerHeight = 0;
  private speakText = '';
  private busy = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: CardCallbacks,
  ) {}

  get visible(): boolean {
    return this.node !== null;
  }

  get element(): HTMLElement | null {
    return this.node;
  }

  open(anchor: Box, headerHeight: number): void {
    this.anchor = anchor;
    this.headerHeight = headerHeight;
    if (this.node) {
      this.reposition();
      return;
    }

    this.headNode = el('div', { class: 'cw-card-head' });
    this.bodyNode = el('div', { class: 'cw-card-body', attrs: { tabindex: '-1' } });
    this.actionsNode = el('div', { class: 'cw-actions' });
    this.chatNode = this.buildChat();

    this.node = el(
      'div',
      {
        class: 'cw-card',
        attrs: {
          role: 'dialog',
          'aria-modal': 'false',
          'aria-label': 'ClariWord explanation',
          'data-expanded': 'false',
        },
        on: { keydown: this.onKeyDown },
      },
      [this.headNode, this.bodyNode, this.actionsNode, this.chatNode],
    );
    this.container.append(this.node);
    this.reposition();
  }

  /** Card is anchored on open and stays put while the page scrolls. */
  reposition(): void {
    if (!this.node || !this.anchor) return;
    const size = {
      width: this.node.offsetWidth || 372,
      height: this.node.offsetHeight || 260,
    };
    const { top, left } = place(this.anchor, size, viewportSize(), { gap: 10, headerHeight: this.headerHeight });
    this.node.style.top = `${Math.round(top)}px`;
    this.node.style.left = `${Math.round(left)}px`;
  }

  setAnchor(rect: DOMRect, headerHeight: number): void {
    this.anchor = toBox(rect);
    this.headerHeight = headerHeight;
  }

  close(): void {
    this.node?.remove();
    this.node = null;
    this.bodyNode = null;
    this.headNode = null;
    this.actionsNode = null;
    this.chatNode = null;
    this.chatLog = null;
    this.chatInput = null;
    this.chatSend = null;
    this.saveButton = null;
    this.speakButton = null;
    this.anchor = null;
  }

  /* -------------------------------------------------------------- */
  /* States                                                          */
  /* -------------------------------------------------------------- */

  setLoading(term: string, message = 'Understanding this in context…'): void {
    if (!this.bodyNode || !this.headNode || !this.actionsNode) return;
    this.busy = true;
    clear(this.headNode);
    this.headNode.append(
      el('div', { class: 'cw-head-main' }, [
        el('h2', {
          class: term.length > 42 ? 'cw-term cw-term-long' : 'cw-term',
          text: truncate(term, 120),
        }),
      ]),
      this.closeButton(),
    );

    clear(this.bodyNode);
    this.bodyNode.append(
      el('div', { class: 'cw-loading', attrs: { role: 'status', 'aria-live': 'polite' } }, [
        el('span', { class: 'cw-dots' }, [el('i'), el('i'), el('i')]),
        el('span', { text: message }),
      ]),
      el('div', { class: 'cw-skeleton', attrs: { 'aria-hidden': 'true' } }, [el('span'), el('span'), el('span')]),
    );
    clear(this.actionsNode);
    this.chatNode?.setAttribute('hidden', '');
    this.reposition();
  }

  setError(error: ClariErrorShape): void {
    if (!this.bodyNode || !this.actionsNode) return;
    this.busy = false;
    clear(this.bodyNode);
    this.bodyNode.append(
      el('div', { class: 'cw-error', attrs: { role: 'alert' } }, [
        el('span', { class: 'cw-error-title', text: error.message }),
        error.hint ? el('span', { class: 'cw-error-hint', text: error.hint }) : null,
      ]),
    );
    clear(this.actionsNode);
    if (error.retryable) {
      this.actionsNode.append(
        el(
          'button',
          {
            class: 'cw-action',
            attrs: { type: 'button', 'data-primary': 'true' },
            on: { click: () => this.callbacks.onRetry() },
          },
          ['Try again'],
        ),
      );
    }
    this.actionsNode.append(
      el(
        'button',
        {
          class: 'cw-action',
          attrs: { type: 'button' },
          on: { click: () => this.callbacks.onAction('practice') },
        },
        ['Open ClariWord'],
      ),
    );
    this.reposition();
  }

  /**
   * Render a still-arriving explanation.
   *
   * Only the header and whatever prose has landed so far is drawn: the action
   * chips and save button need a complete explanation, and showing controls
   * that are about to be replaced reads as jitter. `setContent` takes over the
   * moment the final payload validates.
   */
  setPartial(options: {
    partial: Partial<Explanation> & { type: Explanation['type'] };
    selectedText: string;
  }): void {
    const { partial, selectedText } = options;
    if (!this.bodyNode || !this.headNode) return;

    const info = headerInfoFor(partial as Explanation, selectedText);
    this.speakText = info.speakText;

    clear(this.headNode);
    const pron = el('div', { class: 'cw-pron' });
    if (info.ipa) pron.append(el('span', { class: 'cw-ipa', text: info.ipa }));
    const phonetic = renderPhonetic(info.phonetic);
    if (phonetic) pron.append(phonetic);
    if (info.partOfSpeech) pron.append(el('span', { class: 'cw-pos', text: info.partOfSpeech }));

    this.headNode.append(
      el('div', { class: 'cw-head-main' }, [
        el('h2', {
          class: info.long ? 'cw-term cw-term-long' : 'cw-term',
          text: truncate(info.title, 160),
        }),
        pron.childElementCount ? pron : null,
      ]),
      this.closeButton(),
    );

    clear(this.bodyNode);
    this.bodyNode.append(
      renderExplanation(partial as Explanation, {
        onVocabularyClick: (word) => this.callbacks.onVocabularyClick(word),
      }),
    );
  }

  setContent(options: {
    explanation: Explanation;
    meta: ExplainResponseMeta;
    selectedText: string;
    saved: boolean;
    encounterCount: number;
  }): void {
    const { explanation, meta, selectedText, saved, encounterCount } = options;
    if (!this.bodyNode || !this.headNode || !this.actionsNode) return;
    this.busy = false;

    const info = headerInfoFor(explanation, selectedText);
    this.speakText = info.speakText;

    /* header */
    clear(this.headNode);
    const pron = el('div', { class: 'cw-pron' });
    if (info.ipa) pron.append(el('span', { class: 'cw-ipa', text: info.ipa }));
    const phonetic = renderPhonetic(info.phonetic);
    if (phonetic) pron.append(phonetic);
    if (info.partOfSpeech) pron.append(el('span', { class: 'cw-pos', text: info.partOfSpeech }));

    this.speakButton = el(
      'button',
      {
        class: 'cw-icon-btn',
        attrs: { type: 'button', 'aria-label': 'Listen to pronunciation', 'data-variant': 'speak' },
        on: { click: () => this.callbacks.onAction('pronounce') },
      },
      [svg(ICONS.speaker)],
    );

    this.saveButton = el(
      'button',
      {
        class: 'cw-icon-btn',
        attrs: {
          type: 'button',
          'aria-label': saved ? 'Saved to your vocabulary' : 'Save to your vocabulary',
          'aria-pressed': saved ? 'true' : 'false',
        },
        on: { click: () => this.callbacks.onAction('save') },
      },
      [svg(saved ? ICONS.bookmark : ICONS.bookmarkOutline)],
    );

    this.headNode.append(
      el('div', { class: 'cw-head-main' }, [
        el('h2', {
          class: info.long ? 'cw-term cw-term-long' : 'cw-term',
          text: truncate(info.title, 160),
        }),
        pron.childElementCount ? pron : null,
      ]),
      this.speakButton,
      this.saveButton,
      this.closeButton(),
    );

    /* body */
    clear(this.bodyNode);
    if (encounterCount > 1) {
      this.bodyNode.append(
        el('div', { class: 'cw-note', attrs: { style: 'margin-bottom:12px' } }, [
          el('span', { text: `You've encountered this ${encounterCount} times.` }),
        ]),
      );
    }
    this.bodyNode.append(
      renderExplanation(explanation, { onVocabularyClick: (word) => this.callbacks.onVocabularyClick(word) }),
    );
    if (meta.source === 'mock') {
      this.bodyNode.append(
        el('div', { class: 'cw-note', attrs: { 'data-variant': 'demo' } }, [
          el('span', { text: 'Offline mode — this explanation comes from the built-in lexicon because the ClariWord service could not be reached.' }),
        ]),
      );
    }

    /* actions */
    clear(this.actionsNode);
    const specs = ACTIONS_BY_TYPE[explanation.type];
    for (const spec of specs) {
      this.actionsNode.append(
        el(
          'button',
          {
            class: 'cw-action',
            attrs: { type: 'button', 'data-action': spec.id, 'data-primary': spec.primary ? 'true' : undefined },
            on: { click: () => this.callbacks.onAction(spec.id) },
          },
          [spec.icon ? svg(spec.icon) : null, spec.label].filter(Boolean) as (Node | string)[],
        ),
      );
    }
    this.actionsNode.append(
      el(
        'button',
        {
          class: 'cw-action',
          attrs: { type: 'button', 'data-action': 'save', 'data-primary': 'true', 'aria-pressed': saved ? 'true' : 'false' },
          on: { click: () => this.callbacks.onAction('save') },
        },
        [svg(saved ? ICONS.bookmark : ICONS.bookmarkOutline), saved ? 'Saved' : 'Save'],
      ),
    );

    this.chatNode?.removeAttribute('hidden');
    this.reposition();
  }

  markSaved(saved: boolean): void {
    if (this.saveButton) {
      clear(this.saveButton);
      this.saveButton.append(svg(saved ? ICONS.bookmark : ICONS.bookmarkOutline));
      this.saveButton.setAttribute('aria-pressed', saved ? 'true' : 'false');
      this.saveButton.setAttribute('aria-label', saved ? 'Saved to your vocabulary' : 'Save to your vocabulary');
    }
    const action = this.actionsNode?.querySelector<HTMLButtonElement>('[data-action="save"]');
    if (action) {
      clear(action);
      action.append(svg(saved ? ICONS.bookmark : ICONS.bookmarkOutline), document.createTextNode(saved ? 'Saved' : 'Save'));
      action.setAttribute('aria-pressed', saved ? 'true' : 'false');
    }
  }

  setSpeaking(speaking: boolean): void {
    if (!this.speakButton) return;
    clear(this.speakButton);
    this.speakButton.append(svg(speaking ? ICONS.pause : ICONS.speaker));
    this.speakButton.setAttribute('aria-label', speaking ? 'Pause pronunciation' : 'Listen to pronunciation');
    this.speakButton.setAttribute('aria-pressed', speaking ? 'true' : 'false');
  }

  get currentSpeakText(): string {
    return this.speakText;
  }

  /* -------------------------------------------------------------- */
  /* Chat                                                            */
  /* -------------------------------------------------------------- */

  private buildChat(): HTMLElement {
    this.chatLog = el('div', { class: 'cw-chat-log', attrs: { role: 'log', 'aria-live': 'polite' } });
    this.chatInput = el('textarea', {
      class: 'cw-chat-input',
      attrs: {
        rows: '1',
        placeholder: 'Ask about this…',
        'aria-label': 'Ask a follow-up question about this selection',
      },
      on: {
        input: () => this.autoGrow(),
        keydown: (event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void this.submitQuestion();
          }
        },
      },
    });
    this.chatSend = el(
      'button',
      {
        class: 'cw-chat-send',
        attrs: { type: 'submit', 'aria-label': 'Send question' },
      },
      [svg(ICONS.send)],
    );

    const form = el(
      'form',
      {
        class: 'cw-chat-form',
        on: {
          submit: (event) => {
            event.preventDefault();
            void this.submitQuestion();
          },
        },
      },
      [this.chatInput, this.chatSend],
    );

    const chat = el('div', { class: 'cw-chat', attrs: { hidden: true } }, [this.chatLog, form]);
    return chat;
  }

  private autoGrow(): void {
    if (!this.chatInput) return;
    this.chatInput.style.height = 'auto';
    this.chatInput.style.height = `${Math.min(96, this.chatInput.scrollHeight)}px`;
  }

  private async submitQuestion(): Promise<void> {
    if (!this.chatInput || this.busy) return;
    const question = this.chatInput.value.trim();
    if (!question) return;
    this.chatInput.value = '';
    this.autoGrow();
    await this.callbacks.onAsk(question);
  }

  appendChatMessage(message: ChatMessage): void {
    if (!this.chatLog || !this.node) return;
    this.node.dataset.expanded = 'true';
    this.chatLog.append(
      el('div', { class: 'cw-msg', attrs: { 'data-role': message.role }, text: message.content }),
    );
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
    this.reposition();
  }

  setChatBusy(busy: boolean): void {
    this.busy = busy;
    if (this.chatSend) this.chatSend.disabled = busy;
    if (!this.chatLog) return;
    const existing = this.chatLog.querySelector('[data-pending="true"]');
    if (busy && !existing) {
      this.chatLog.append(
        el('div', { class: 'cw-loading', attrs: { 'data-pending': 'true', role: 'status' } }, [
          el('span', { class: 'cw-dots' }, [el('i'), el('i'), el('i')]),
          el('span', { text: 'Thinking…' }),
        ]),
      );
      this.chatLog.scrollTop = this.chatLog.scrollHeight;
    }
    if (!busy) existing?.remove();
  }

  focusChat(): void {
    this.chatInput?.focus();
  }

  /* -------------------------------------------------------------- */
  /* Keyboard                                                        */
  /* -------------------------------------------------------------- */

  focusFirst(): void {
    const targets = this.node ? focusable(this.node) : [];
    (targets[0] ?? this.bodyNode)?.focus();
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.callbacks.onClose();
      return;
    }
    if (event.key !== 'Tab' || !this.node) return;

    // Keep Tab inside the card: it is an overlay on someone else's page, and
    // tabbing into the page behind it loses the user completely.
    const targets = focusable(this.node);
    if (targets.length === 0) return;
    const first = targets[0] as HTMLElement;
    const last = targets[targets.length - 1] as HTMLElement;
    const active = this.node.getRootNode() as ShadowRoot;
    const current = active.activeElement as HTMLElement | null;

    if (event.shiftKey && current === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  };

  private closeButton(): HTMLButtonElement {
    return el(
      'button',
      {
        class: 'cw-icon-btn',
        attrs: { type: 'button', 'aria-label': 'Close (Esc)' },
        on: { click: () => this.callbacks.onClose() },
      },
      [svg(ICONS.close)],
    );
  }
}
