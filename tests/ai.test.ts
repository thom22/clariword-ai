import assert from 'node:assert/strict';
import test from 'node:test';
import { AiService, buildOutgoingContext, describeOutgoingPayload } from '@/services/ai-service';
import { createMockExplanation } from '@/services/mock-ai';
import { DEFAULT_SETTINGS } from '@/shared/defaults';
import { ClariError } from '@/shared/errors';
import type { ExplainRequest, PageContext, Settings } from '@/types';

const context: PageContext = {
  selectedText: 'ostensibly',
  sentence: "The policy's ostensibly pragmatic approach belies a deeper ideological shift.",
  previousSentence: 'Ministers announced the change on Tuesday.',
  nextSentence: 'Critics were quick to respond.',
  pageTitle: 'Why AI Regulation Is Becoming More Complicated',
  pageUrl: 'https://example.com/article?utm_source=newsletter&user=1234',
  pageDomain: 'example.com',
};

const settings = (overrides: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...overrides });

const request = (overrides: Partial<ExplainRequest> = {}): ExplainRequest => ({
  context,
  kind: 'word',
  explanationLevel: 'intermediate',
  accent: 'american',
  ...overrides,
});

/* ---------------- privacy ---------------- */

test('default settings never transmit the page URL or title', () => {
  const outgoing = buildOutgoingContext(context, settings());
  assert.equal(outgoing.pageUrl, '');
  assert.equal(outgoing.pageTitle, '');
  assert.equal(outgoing.pageDomain, '');
  assert.equal(outgoing.selectedText, 'ostensibly');
  assert.ok(outgoing.previousSentence.length > 0, 'neighbouring context is on by default');
});

test('opting into page metadata sends the domain but still not the URL', () => {
  const outgoing = buildOutgoingContext(context, settings({ sendPageMetadata: true }));
  assert.equal(outgoing.pageDomain, 'example.com');
  assert.equal(outgoing.pageUrl, '', 'query strings can carry identifiers, so the URL is never sent');
  assert.equal(outgoing.pageTitle, 'Why AI Regulation Is Becoming More Complicated');
});

test('turning off neighbouring context drops the surrounding sentences', () => {
  const outgoing = buildOutgoingContext(context, settings({ sendNeighbouringContext: false }));
  assert.equal(outgoing.previousSentence, '');
  assert.equal(outgoing.nextSentence, '');
  assert.ok(outgoing.sentence.length > 0, 'the sentence containing the selection is still needed');
});

test('a selection identical to its sentence is not sent twice', () => {
  const outgoing = buildOutgoingContext({ ...context, selectedText: context.sentence }, settings());
  assert.equal(outgoing.sentence, '');
});

test('describeOutgoingPayload matches what is actually sent', () => {
  const description = describeOutgoingPayload(context, settings());
  assert.match(description, /characters of selected text/);
  assert.doesNotMatch(description, /example\.com/);
  assert.match(describeOutgoingPayload(context, settings({ sendPageMetadata: true })), /example\.com/);
});

/* ---------------- demo mode ---------------- */

test('demo mode explains the curated words properly', () => {
  const explanation = createMockExplanation(request());
  assert.equal(explanation.type, 'word');
  if (explanation.type !== 'word') return;
  assert.equal(explanation.phonetic, 'os-TEN-suh-blee');
  assert.equal(explanation.ipa, '/ɑːˈstɛnsəbli/');
  assert.ok(explanation.contextualMeaning.length > 0);
  assert.ok(explanation.authorIntent.length > 0);
});

test('demo mode never invents a definition it does not have', () => {
  const explanation = createMockExplanation(
    request({ context: { ...context, selectedText: 'sesquipedalian' } }),
  );
  if (explanation.type !== 'word') throw new Error('wrong type');
  assert.match(explanation.contextualMeaning, /Demo mode/);
  assert.equal(explanation.confidence, 'low');
  assert.equal(explanation.synonyms.length, 0);
});

test('British accent changes the IPA', () => {
  const american = createMockExplanation(request({ accent: 'american' }));
  const british = createMockExplanation(request({ accent: 'british' }));
  if (american.type !== 'word' || british.type !== 'word') throw new Error('wrong type');
  assert.notEqual(american.ipa, british.ipa);
});

test('beginner level simplifies and drops author-intent nuance', () => {
  const beginner = createMockExplanation(request({ explanationLevel: 'beginner' }));
  const advanced = createMockExplanation(request({ explanationLevel: 'advanced' }));
  if (beginner.type !== 'word' || advanced.type !== 'word') throw new Error('wrong type');
  assert.equal(beginner.authorIntent, '');
  assert.ok(advanced.authorIntent.length > 0);
  assert.ok(beginner.contextualMeaning.length < advanced.contextualMeaning.length);
});

test('a sentence gets a breakdown rather than a pile of definitions', () => {
  const explanation = createMockExplanation(
    request({ context: { ...context, selectedText: context.sentence }, kind: 'sentence' }),
  );
  assert.equal(explanation.type, 'sentence');
  if (explanation.type !== 'sentence') return;
  assert.ok(explanation.segments.length >= 3);
  assert.ok(explanation.keyVocabulary.length >= 3);
  assert.ok(explanation.simplifiedRewrite.length > 0);
});

test('a phrase is explained as a unit', () => {
  const explanation = createMockExplanation(
    request({ context: { ...context, selectedText: 'move the goalposts' }, kind: 'phrase' }),
  );
  assert.equal(explanation.type, 'phrase');
  if (explanation.type !== 'phrase') return;
  assert.equal(explanation.figurative, true);
  assert.ok(explanation.literalMeaning);
});

/* ---------------- service behaviour ---------------- */

test('demo responses go through the same validator as the backend', async () => {
  const service = new AiService();
  // Explicitly demo mode: the shipped default now points at the hosted
  // service, and this test must not depend on the network.
  const response = await service.explain(request(), settings({ aiMode: 'mock' }));
  assert.equal(response.meta.source, 'mock');
  assert.equal(response.explanation.type, 'word');
});

test('identical requests are served from cache', async () => {
  const service = new AiService();
  await service.explain(request(), settings({ aiMode: 'mock' }));
  const second = await service.explain(request(), settings({ aiMode: 'mock' }));
  assert.equal(second.meta.cached, true);
});

test('an over-long selection is refused before anything is sent', async () => {
  const service = new AiService();
  const long = 'word '.repeat(500);
  await assert.rejects(
    () => service.explain(request({ context: { ...context, selectedText: long } }), settings()),
    (error: unknown) => {
      assert.ok(error instanceof ClariError);
      assert.equal(error.code, 'SELECTION_TOO_LONG');
      assert.match(error.hint ?? '', /1,200 characters/);
      return true;
    },
  );
});

test('an empty selection is refused', async () => {
  const service = new AiService();
  await assert.rejects(
    () => service.explain(request({ context: { ...context, selectedText: '  ' } }), settings()),
    (error: unknown) => error instanceof ClariError && error.code === 'EMPTY_SELECTION',
  );
});

test('backend mode with no URL asks the user to configure one', async () => {
  const service = new AiService();
  await assert.rejects(
    () => service.explain(request(), settings({ aiMode: 'backend', backendUrl: '' })),
    (error: unknown) => error instanceof ClariError && error.code === 'NOT_CONFIGURED',
  );
});

test('an unreachable backend produces a retryable error with a way out', async () => {
  const service = new AiService();
  await assert.rejects(
    () =>
      service.explain(
        request({ context: { ...context, selectedText: 'unreachable-probe' } }),
        settings({ aiMode: 'backend', backendUrl: 'http://127.0.0.1:9' }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof ClariError);
      assert.equal(error.code, 'BACKEND_UNREACHABLE');
      assert.equal(error.retryable, true);
      // The hint must still offer the reader a way forward. It no longer names
      // Demo mode, because the service is preconfigured and there is nothing
      // for the reader to switch to.
      assert.match(error.hint ?? '', /try again/i);
      return true;
    },
  );
});
