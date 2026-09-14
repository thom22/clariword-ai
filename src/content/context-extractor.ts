import { MAX_CONTEXT_SENTENCE_CHARS } from '@/shared/constants';
import { domainOf, findSentenceAround, normalizeWhitespace, splitSentences, truncate } from '@/shared/text';
import type { SelectionSnapshot } from '@/content/selection-manager';
import type { PageContext } from '@/types';

/**
 * Builds the smallest useful context around a selection.
 *
 * The goal is disambiguation ("bank" on a river-walk blog vs a finance site),
 * not comprehension of the whole page — so we read one block element and,
 * only when needed, one neighbour on each side. Nothing else is ever collected.
 */

const BLOCK_SELECTOR =
  'p, li, blockquote, td, th, dd, dt, h1, h2, h3, h4, h5, h6, figcaption, pre, article, section, main, div';

/** Elements whose text is navigation/boilerplate rather than reading matter. */
const SKIP_SELECTOR = 'nav, header, footer, aside, script, style, noscript, svg, button, select, textarea, input';

const MAX_BLOCK_CHARS = 4000;

export function extractContext(snapshot: SelectionSnapshot): PageContext {
  const selectedText = normalizeWhitespace(snapshot.text);
  const base: PageContext = {
    selectedText,
    sentence: selectedText,
    previousSentence: '',
    nextSentence: '',
    pageTitle: normalizeWhitespace(document.title),
    pageUrl: location.href,
    pageDomain: domainOf(location.href),
  };

  if (snapshot.field) return { ...base, ...fieldContext(snapshot.field, selectedText) };

  const block = snapshot.range ? nearestBlock(snapshot.range.commonAncestorContainer) : null;
  if (!block) return base;

  const blockText = readableText(block);
  if (!blockText) return base;

  const neighbourhood = findSentenceAround(blockText, selectedText);
  let previous = neighbourhood.previous;
  let next = neighbourhood.next;

  // The sentence before ours may live in the previous paragraph.
  if (!previous) previous = lastSentenceOf(siblingBlock(block, 'previous'));
  if (!next) next = firstSentenceOf(siblingBlock(block, 'next'));

  return {
    ...base,
    sentence: truncate(neighbourhood.sentence || selectedText, MAX_CONTEXT_SENTENCE_CHARS),
    previousSentence: truncate(previous, MAX_CONTEXT_SENTENCE_CHARS),
    nextSentence: truncate(next, MAX_CONTEXT_SENTENCE_CHARS),
  };
}

function fieldContext(
  field: HTMLInputElement | HTMLTextAreaElement,
  selectedText: string,
): Partial<PageContext> {
  const neighbourhood = findSentenceAround(field.value, selectedText);
  return {
    sentence: truncate(neighbourhood.sentence || selectedText, MAX_CONTEXT_SENTENCE_CHARS),
    previousSentence: truncate(neighbourhood.previous, MAX_CONTEXT_SENTENCE_CHARS),
    nextSentence: truncate(neighbourhood.next, MAX_CONTEXT_SENTENCE_CHARS),
  };
}

/**
 * Walk up to the closest element that reads like a block of prose. We stop at
 * the first ancestor with a reasonable amount of text so we do not end up with
 * the whole <article>.
 */
function nearestBlock(node: Node): Element | null {
  let element: Element | null = node instanceof Element ? node : node.parentElement;
  let fallback: Element | null = null;

  while (element && element !== document.body) {
    if (element.matches(BLOCK_SELECTOR) && !element.closest(SKIP_SELECTOR)) {
      const length = (element.textContent ?? '').trim().length;
      if (length > 0) {
        fallback ??= element;
        // A paragraph-sized chunk is ideal; anything bigger is too much page.
        if (length >= 40 && length <= MAX_BLOCK_CHARS) return element;
      }
    }
    element = element.parentElement;
  }
  return fallback;
}

function readableText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll(SKIP_SELECTOR).forEach((node) => node.remove());
  return truncate(normalizeWhitespace(clone.textContent ?? ''), MAX_BLOCK_CHARS);
}

function siblingBlock(element: Element, direction: 'previous' | 'next'): string {
  let sibling = direction === 'previous' ? element.previousElementSibling : element.nextElementSibling;
  let hops = 0;
  while (sibling && hops < 4) {
    if (!sibling.matches(SKIP_SELECTOR)) {
      const text = readableText(sibling);
      if (text.length > 20) return text;
    }
    sibling = direction === 'previous' ? sibling.previousElementSibling : sibling.nextElementSibling;
    hops += 1;
  }
  return '';
}

function lastSentenceOf(text: string): string {
  const sentences = splitSentences(text);
  return sentences.length ? (sentences[sentences.length - 1] as string) : '';
}

function firstSentenceOf(text: string): string {
  const sentences = splitSentences(text);
  return sentences.length ? (sentences[0] as string) : '';
}
