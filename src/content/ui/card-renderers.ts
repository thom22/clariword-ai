import { el } from '@/content/ui/dom';
import { parsePhonetic } from '@/shared/text';
import type {
  Explanation,
  KeyVocabularyItem,
  PassageExplanation,
  PhraseExplanation,
  Segment,
  SentenceExplanation,
  WordExplanation,
} from '@/types';

/**
 * Turns a validated explanation into DOM.
 *
 * Ordering is the product: the contextual reading comes first, the generic
 * dictionary meaning second. That is the whole difference between ClariWord
 * and a dictionary popup, so it is enforced here rather than left to the model.
 */

export interface RenderHandlers {
  onVocabularyClick?(word: string): void;
}

function section(label: string, ...children: (Node | null | false)[]): HTMLElement | null {
  const kept = children.filter((child): child is Node => !!child);
  if (kept.length === 0) return null;
  return el('div', { class: 'cw-section' }, [el('span', { class: 'cw-label', text: label }), ...kept]);
}

function paragraph(text: string, variant?: 'lead' | 'soft' | 'quote'): HTMLElement | null {
  if (!text) return null;
  const classes = ['cw-body-text'];
  if (variant === 'lead') classes.push('cw-lead');
  if (variant === 'soft') classes.push('cw-soft');
  if (variant === 'quote') return el('p', { class: 'cw-quote', text });
  return el('p', { class: classes.join(' '), text });
}

function tone(text: string): HTMLElement | null {
  return text ? el('span', { class: 'cw-tone', text }) : null;
}

function chips(items: string[], handlers?: RenderHandlers): HTMLElement | null {
  if (items.length === 0) return null;
  return el(
    'div',
    { class: 'cw-chips' },
    items.map((item) =>
      el('span', {
        class: 'cw-chip',
        text: item,
        attrs: handlers?.onVocabularyClick ? { 'data-clickable': 'true', role: 'button', tabindex: '0' } : {},
        on: handlers?.onVocabularyClick
          ? {
              click: () => handlers.onVocabularyClick?.(item),
              keydown: (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handlers.onVocabularyClick?.(item);
                }
              },
            }
          : {},
      }),
    ),
  );
}

function segments(items: Segment[]): HTMLElement | null {
  if (items.length === 0) return null;
  return el(
    'div',
    { class: 'cw-segments' },
    items.map((segment) =>
      el('div', { class: 'cw-segment' }, [
        el('span', { class: 'cw-segment-text', text: `“${segment.text}”` }),
        el('span', { class: 'cw-segment-meaning', text: segment.meaning }),
      ]),
    ),
  );
}

function vocabulary(items: KeyVocabularyItem[], handlers?: RenderHandlers): HTMLElement | null {
  if (items.length === 0) return null;
  return el(
    'div',
    { class: 'cw-vocab' },
    items.map((item) => {
      const word = el('span', { class: 'cw-vocab-word', text: item.word });
      const row = el('div', { class: 'cw-vocab-row' }, [
        handlers?.onVocabularyClick
          ? el(
              'button',
              {
                class: 'cw-vocab-word',
                attrs: { type: 'button', 'aria-label': `Explain ${item.word}` },
                on: { click: () => handlers.onVocabularyClick?.(item.word) },
              },
              [item.word],
            )
          : word,
        item.gloss ? el('span', { class: 'cw-vocab-gloss', text: item.gloss }) : null,
      ]);
      return row;
    }),
  );
}

function bulletList(items: string[]): HTMLElement | null {
  if (items.length === 0) return null;
  return el(
    'div',
    { class: 'cw-segments' },
    items.map((item) => el('span', { class: 'cw-segment-meaning', text: item })),
  );
}

/* ------------------------------------------------------------------ */
/* Per-type renderers                                                  */
/* ------------------------------------------------------------------ */

function renderWord(explanation: WordExplanation, handlers: RenderHandlers): (HTMLElement | null)[] {
  const contextual =
    explanation.sentenceExplanation && explanation.sentenceExplanation !== explanation.contextualMeaning
      ? section('In this sentence', paragraph(explanation.sentenceExplanation, 'soft'))
      : null;

  return [
    section('Here it means', paragraph(explanation.contextualMeaning, 'lead')),
    contextual,
    explanation.simpleMeaning !== explanation.contextualMeaning
      ? section('Simple meaning', paragraph(explanation.simpleMeaning, 'soft'))
      : null,
    explanation.naturalAlternative
      ? section('Natural alternative', paragraph(`“${explanation.naturalAlternative}”`, 'soft'))
      : null,
    section('Tone', tone([explanation.tone, explanation.register].filter(Boolean).join(' · '))),
    section('Synonyms', chips(explanation.synonyms, handlers)),
    section('Example', paragraph(explanation.example, 'quote')),
    section('Why this word?', paragraph(explanation.authorIntent, 'soft')),
    explanation.ambiguityNote
      ? el('div', { class: 'cw-note' }, [el('span', { text: explanation.ambiguityNote })])
      : null,
  ];
}

function renderSentence(explanation: SentenceExplanation, handlers: RenderHandlers): (HTMLElement | null)[] {
  return [
    section('Simple meaning', paragraph(explanation.simpleMeaning, 'lead')),
    section('Break it down', segments(explanation.segments)),
    section('What the author really means', paragraph(explanation.authorMeaning, 'soft')),
    section('Tone', tone([explanation.tone, explanation.register].filter(Boolean).join(' · '))),
    section('Simpler rewrite', paragraph(explanation.simplifiedRewrite, 'quote')),
    section('Important vocabulary', vocabulary(explanation.keyVocabulary, handlers)),
    explanation.grammarNote ? section('Grammar', paragraph(explanation.grammarNote, 'soft')) : null,
  ];
}

function renderPhrase(explanation: PhraseExplanation, handlers: RenderHandlers): (HTMLElement | null)[] {
  return [
    section('Meaning', paragraph(explanation.meaning, 'lead')),
    explanation.contextualMeaning !== explanation.meaning
      ? section('In this context', paragraph(explanation.contextualMeaning, 'soft'))
      : null,
    explanation.literalMeaning
      ? section(
          explanation.figurative ? 'Literal vs figurative' : 'Literal meaning',
          paragraph(explanation.literalMeaning, 'soft'),
        )
      : null,
    section('Register', tone([explanation.register, explanation.tone].filter(Boolean).join(' · '))),
    section('Example', paragraph(explanation.example, 'quote')),
    section('Other ways to say it', chips(explanation.alternatives, handlers)),
    section('Words inside it', vocabulary(explanation.keyVocabulary, handlers)),
  ];
}

function renderPassage(explanation: PassageExplanation, handlers: RenderHandlers): (HTMLElement | null)[] {
  return [
    section('In short', paragraph(explanation.summary, 'lead')),
    section('Key points', bulletList(explanation.keyPoints)),
    section('Sentence by sentence', segments(explanation.segments)),
    section('Tone', tone([explanation.tone, explanation.register].filter(Boolean).join(' · '))),
    section('Simpler rewrite', paragraph(explanation.simplifiedRewrite, 'quote')),
    section('Key vocabulary', vocabulary(explanation.keyVocabulary, handlers)),
  ];
}

export function renderExplanation(explanation: Explanation, handlers: RenderHandlers = {}): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const blocks =
    explanation.type === 'word'
      ? renderWord(explanation, handlers)
      : explanation.type === 'sentence'
        ? renderSentence(explanation, handlers)
        : explanation.type === 'phrase'
          ? renderPhrase(explanation, handlers)
          : renderPassage(explanation, handlers);

  for (const block of blocks) if (block) fragment.append(block);
  return fragment;
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

export interface HeaderInfo {
  title: string;
  ipa: string;
  phonetic: string;
  partOfSpeech: string;
  /** Text handed to speech synthesis when the user presses Listen. */
  speakText: string;
  long: boolean;
}

export function headerInfoFor(explanation: Explanation, selectedText: string): HeaderInfo {
  switch (explanation.type) {
    case 'word':
      return {
        title: explanation.word || selectedText,
        ipa: explanation.ipa,
        phonetic: explanation.phonetic,
        partOfSpeech: explanation.partOfSpeech,
        speakText: explanation.word || selectedText,
        long: false,
      };
    case 'phrase':
      return {
        title: explanation.phrase || selectedText,
        ipa: '',
        phonetic: '',
        partOfSpeech: explanation.figurative ? 'idiom' : 'phrase',
        speakText: explanation.phrase || selectedText,
        long: (explanation.phrase || selectedText).length > 40,
      };
    default:
      return {
        title: selectedText,
        ipa: '',
        phonetic: '',
        partOfSpeech: explanation.type,
        speakText: selectedText,
        long: true,
      };
  }
}

/** Renders "os-TEN-suh-blee" with the stressed syllable visually marked. */
export function renderPhonetic(phonetic: string): HTMLElement | null {
  if (!phonetic) return null;
  const { syllables, stressIndex } = parsePhonetic(phonetic);
  if (syllables.length === 0) return null;

  const container = el('span', {
    class: 'cw-phonetic',
    attrs: { 'aria-label': `Pronounced ${phonetic.replace(/-/g, ' ')}` },
  });
  syllables.forEach((syllable, index) => {
    const stressed = index === stressIndex;
    container.append(
      el('span', {
        class: stressed ? 'cw-stress' : '',
        text: syllable,
        // Do not rely on colour alone: the stressed syllable stays in CAPS.
        attrs: stressed ? { 'data-stress': 'primary' } : {},
      }),
    );
    if (index < syllables.length - 1) container.append(document.createTextNode('-'));
  });
  return container;
}
