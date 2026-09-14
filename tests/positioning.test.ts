import assert from 'node:assert/strict';
import test from 'node:test';
import { isVisible, place } from '@/content/positioning';

const viewport = { width: 1200, height: 800 };
const card = { width: 372, height: 300 };

test('the card sits below the selection when there is room', () => {
  const result = place({ top: 200, left: 500, width: 80, height: 20 }, card, viewport);
  assert.equal(result.placement, 'below');
  assert.equal(result.top, 228);
  assert.equal(result.left, 500 + 40 - 186);
});

test('it flips above when the selection is near the bottom', () => {
  const result = place({ top: 740, left: 500, width: 80, height: 20 }, card, viewport);
  assert.equal(result.placement, 'above');
  assert.ok(result.top + card.height <= viewport.height);
});

test('it never hides under a fixed site header', () => {
  const result = place({ top: 90, left: 500, width: 80, height: 20 }, card, viewport, { headerHeight: 72 });
  assert.ok(result.top >= 72, `expected top >= 72, got ${result.top}`);
});

test('it stays inside the viewport at the left edge', () => {
  const result = place({ top: 300, left: 2, width: 30, height: 20 }, card, viewport);
  assert.ok(result.left >= 8);
});

test('it stays inside the viewport at the right edge', () => {
  const result = place({ top: 300, left: 1190, width: 30, height: 20 }, card, viewport);
  assert.ok(result.left + card.width <= viewport.width - 8 + 0.001);
});

test('a card taller than the viewport is clamped, not pushed off-screen', () => {
  const tall = { width: 372, height: 900 };
  const result = place({ top: 400, left: 600, width: 80, height: 20 }, tall, viewport);
  assert.ok(result.top >= 8);
});

test('on a narrow phone-width viewport the card still fits', () => {
  const narrow = { width: 380, height: 700 };
  const result = place({ top: 300, left: 300, width: 60, height: 18 }, card, narrow);
  assert.ok(result.left >= 8);
  assert.ok(result.left + card.width <= Math.max(card.width, narrow.width) + 8);
});

test('isVisible reports selections scrolled out of view', () => {
  assert.equal(isVisible({ top: 100, left: 0, width: 10, height: 20 }, viewport), true);
  assert.equal(isVisible({ top: -40, left: 0, width: 10, height: 20 }, viewport), false);
  assert.equal(isVisible({ top: 900, left: 0, width: 10, height: 20 }, viewport), false);
});
