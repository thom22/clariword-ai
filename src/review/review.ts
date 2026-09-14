import { sendMessage } from '@/shared/messaging';
import { clear, el, initPage, query, toast } from '@/ui/page';
import type { ReviewQuestion } from '@/types';

/**
 * Vocabulary review.
 *
 * Deliberately simple: four choices, immediate feedback, and — the part that
 * makes it ClariWord rather than a flashcard app — the original sentence the
 * user met the word in, shown after every answer.
 */

const KEYS = ['A', 'B', 'C', 'D'];

let questions: ReviewQuestion[] = [];
let index = 0;
let correctCount = 0;
let answered = false;

async function main(): Promise<void> {
  await initPage();
  questions = await sendMessage('GET_REVIEW_QUEUE', { limit: 10 });
  if (questions.length === 0) {
    renderEmpty();
    return;
  }
  renderQuestion();
  document.addEventListener('keydown', onKeyDown);
}

function progress(): void {
  const percent = questions.length ? ((index + (answered ? 1 : 0)) / questions.length) * 100 : 0;
  query('#progress-bar').style.width = `${percent}%`;
}

function renderEmpty(): void {
  const stage = query('#stage');
  clear(stage);
  stage.append(
    el('div', { class: 'empty' }, [
      el('h3', { text: 'Nothing to review yet' }),
      el('p', {
        class: 'muted',
        text: 'Save a few words while you read and they will show up here, each with the sentence you found it in.',
      }),
      el('a', { class: 'btn', text: 'Open saved words', attrs: { href: '../vocabulary/vocabulary.html' } }),
    ]),
  );
}

function renderQuestion(): void {
  answered = false;
  const question = questions[index];
  if (!question) return renderSummary();

  const stage = query('#stage');
  clear(stage);

  const choices = el('div', { class: 'choices', attrs: { role: 'group', 'aria-label': 'Answer choices' } });
  question.choices.forEach((choice, position) => {
    choices.append(
      el(
        'button',
        {
          class: 'choice',
          attrs: { type: 'button', 'data-index': position },
          on: { click: () => answer(position) },
        },
        [
          el('span', { class: 'key', text: KEYS[position] ?? String(position + 1), attrs: { 'aria-hidden': 'true' } }),
          el('span', { text: choice }),
        ],
      ),
    );
  });

  stage.append(
    el('div', { class: 'q-meta' }, [
      el('span', { class: 'muted', text: `Question ${index + 1} of ${questions.length}` }),
      el('span', { class: 'faint', text: `${correctCount} correct so far` }),
    ]),
    el('h1', { class: 'q-prompt', text: question.prompt }),
    choices,
    el('p', { class: 'hint', text: 'Press A–D to answer, Enter for the next question.' }),
  );
  progress();
}

function answer(position: number): void {
  if (answered) return;
  const question = questions[index];
  if (!question) return;
  answered = true;

  const correct = position === question.correctIndex;
  if (correct) correctCount += 1;
  void sendMessage('SUBMIT_REVIEW', { entryId: question.entryId, correct }).catch(() => undefined);

  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('.choice'))) {
    const buttonIndex = Number(button.dataset.index);
    button.disabled = true;
    if (buttonIndex === question.correctIndex) {
      button.dataset.state = 'correct';
      button.append(el('span', { class: 'mark', text: 'Correct answer' }));
    } else if (buttonIndex === position) {
      button.dataset.state = 'wrong';
      button.append(el('span', { class: 'mark', text: 'Your answer' }));
    }
  }

  query('#stage').append(feedback(question, correct));
  progress();
  query<HTMLButtonElement>('#next')?.focus();
}

function feedback(question: ReviewQuestion, correct: boolean): HTMLElement {
  const recall = el('div', { class: 'recall' }, [
    el('span', { class: 'label', text: 'Where you met it' }),
    question.originalSentence
      ? el('blockquote', { text: `“${question.originalSentence}”` })
      : el('p', { class: 'muted', text: 'No original sentence was saved for this word.' }),
    el('div', { class: 'recall-meta' }, [
      el('span', { text: question.source?.title || question.source?.domain || 'Source not saved' }),
      question.source?.url
        ? el('a', {
            text: 'View source',
            attrs: { href: question.source.url, target: '_blank', rel: 'noreferrer noopener' },
          })
        : null,
    ]),
  ]);

  return el('div', { class: 'feedback', attrs: { role: 'status' } }, [
    el('div', {
      class: 'verdict',
      attrs: { 'data-correct': String(correct) },
      text: correct ? '✓ Correct' : `✗ Not quite — “${question.term}” means: ${question.choices[question.correctIndex] ?? ''}`,
    }),
    recall,
    el(
      'button',
      {
        class: 'btn',
        attrs: { type: 'button', id: 'next', 'data-variant': 'primary' },
        on: { click: next },
      },
      [index + 1 < questions.length ? 'Next question' : 'See results'],
    ),
  ]);
}

function next(): void {
  index += 1;
  if (index >= questions.length) renderSummary();
  else renderQuestion();
}

function renderSummary(): void {
  const stage = query('#stage');
  clear(stage);
  const percent = questions.length ? Math.round((correctCount / questions.length) * 100) : 0;

  stage.append(
    el('div', { class: 'summary' }, [
      el('span', { class: 'label', text: 'Session complete' }),
      el('div', { class: 'score', text: `${correctCount}/${questions.length}` }),
      el('p', {
        class: 'muted',
        text:
          percent >= 80
            ? 'Strong session. Words you keep getting right move towards Mastered.'
            : 'Missed words come back sooner — that is the point of the schedule.',
      }),
      el('div', { class: 'summary-actions' }, [
        el(
          'button',
          {
            class: 'btn',
            attrs: { type: 'button', 'data-variant': 'primary' },
            on: { click: () => void restart() },
          },
          ['Review again'],
        ),
        el('a', { class: 'btn', text: 'Saved words', attrs: { href: '../vocabulary/vocabulary.html' } }),
      ]),
    ]),
  );
  query('#progress-bar').style.width = '100%';
}

async function restart(): Promise<void> {
  index = 0;
  correctCount = 0;
  questions = await sendMessage('GET_REVIEW_QUEUE', { limit: 10 });
  if (questions.length === 0) renderEmpty();
  else renderQuestion();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && answered) {
    event.preventDefault();
    next();
    return;
  }
  const position = KEYS.indexOf(event.key.toUpperCase());
  if (position !== -1 && !answered) {
    const question = questions[index];
    if (question && position < question.choices.length) answer(position);
  }
}

void main().catch((error: unknown) => {
  toast(error instanceof Error ? error.message : 'Could not start the review.');
});
