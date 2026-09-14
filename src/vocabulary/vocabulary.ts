import { speechService } from '@/services/speech-service';
import { sendMessage } from '@/shared/messaging';
import { formatRelativeDate, truncate } from '@/shared/text';
import { clear, el, initPage, phoneticNodes, query, queryAll, toast } from '@/ui/page';
import type { LearningStatus, Settings, VocabularyEntry } from '@/types';

/**
 * Vocabulary dashboard.
 *
 * The differentiator lives in the detail drawer: every entry keeps the page,
 * the date and the exact sentence where the user first met the word.
 */

type Collection = 'all' | 'recent' | 'encounters' | 'due' | 'mastered' | 'favorites';

const STATUS_LABELS: Record<LearningStatus, string> = {
  new: 'New',
  learning: 'Learning',
  familiar: 'Familiar',
  mastered: 'Mastered',
};

const COLLECTION_TITLES: Record<Collection, string> = {
  all: 'All words',
  recent: 'Recently added',
  encounters: 'Most encountered',
  due: 'Need review',
  mastered: 'Mastered',
  favorites: 'Favourites',
};

let settings: Settings;
let entries: VocabularyEntry[] = [];
let collection: Collection = 'all';
let statusFilter: LearningStatus | 'all' = 'all';
let search = '';
let openEntryId: string | null = null;

async function main(): Promise<void> {
  settings = await initPage();
  wire();
  await reload();

  const focusId = new URLSearchParams(location.search).get('id');
  if (focusId) openDrawer(focusId);
}

async function reload(): Promise<void> {
  entries = await sendMessage('LIST_VOCABULARY', { sort: 'recent' });
  renderCounts();
  renderProgress();
  renderGrid();
}

/* ------------------------------------------------------------------ */
/* Filtering                                                           */
/* ------------------------------------------------------------------ */

function visibleEntries(): VocabularyEntry[] {
  const now = Date.now();
  let list = [...entries];

  switch (collection) {
    case 'recent':
      list = list.sort((a, b) => b.createdAt - a.createdAt).slice(0, 40);
      break;
    case 'encounters':
      list = list.filter((e) => e.encounterCount > 1).sort((a, b) => b.encounterCount - a.encounterCount);
      break;
    case 'due':
      list = list.filter((e) => e.status !== 'mastered' && e.review.due <= now).sort((a, b) => a.review.due - b.review.due);
      break;
    case 'mastered':
      list = list.filter((e) => e.status === 'mastered');
      break;
    case 'favorites':
      list = list.filter((e) => e.favorite);
      break;
    case 'all':
    default:
      list = list.sort((a, b) => b.createdAt - a.createdAt);
  }

  if (statusFilter !== 'all') list = list.filter((entry) => entry.status === statusFilter);

  const needle = search.trim().toLowerCase();
  if (needle) {
    list = list.filter((entry) =>
      [entry.term, entry.definition, entry.contextualMeaning, entry.originalSentence, entry.source?.title ?? '', entry.notes]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }
  return list;
}

function countFor(name: Collection): number {
  const now = Date.now();
  switch (name) {
    case 'all':
      return entries.length;
    case 'recent':
      return entries.filter((e) => Date.now() - e.createdAt < 7 * 86_400_000).length;
    case 'encounters':
      return entries.filter((e) => e.encounterCount > 1).length;
    case 'due':
      return entries.filter((e) => e.status !== 'mastered' && e.review.due <= now).length;
    case 'mastered':
      return entries.filter((e) => e.status === 'mastered').length;
    case 'favorites':
      return entries.filter((e) => e.favorite).length;
  }
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function renderCounts(): void {
  for (const node of queryAll<HTMLElement>('[data-count]')) {
    const name = node.dataset.count as Collection;
    const count = countFor(name);
    node.textContent = count ? String(count) : '';
  }
  query('#subtitle').textContent =
    entries.length === 0
      ? 'Your vocabulary, with the place you met each word'
      : `${entries.length} saved · ${countFor('due')} due for review`;
}

function renderProgress(): void {
  const node = query('#progress');
  clear(node);
  if (entries.length === 0) {
    node.append(el('p', { class: 'muted', text: 'Saved words and their progress will appear here.' }));
    return;
  }
  const statuses: LearningStatus[] = ['new', 'learning', 'familiar', 'mastered'];
  for (const status of statuses) {
    const count = entries.filter((entry) => entry.status === status).length;
    const percent = Math.round((count / entries.length) * 100);
    node.append(
      el('div', { class: 'progress-row' }, [
        el('div', { class: 'progress-head' }, [
          el('span', { text: STATUS_LABELS[status] }),
          el('span', { class: 'muted', text: String(count) }),
        ]),
        el('div', { class: 'bar', attrs: { role: 'img', 'aria-label': `${STATUS_LABELS[status]}: ${count} of ${entries.length}` } }, [
          el('i', { attrs: { style: `width:${percent}%` } }),
        ]),
      ]),
    );
  }
}

function renderGrid(): void {
  const grid = query('#grid');
  const list = visibleEntries();
  clear(grid);

  query('#results-title').textContent = COLLECTION_TITLES[collection];
  query('#results-count').textContent = list.length ? `${list.length} shown` : '';
  query('#empty').hidden = list.length > 0;
  if (entries.length > 0 && list.length === 0) {
    query('#empty-note').textContent = 'No saved words match this filter.';
  }

  for (const entry of list) grid.append(wordCard(entry));
}

function wordCard(entry: VocabularyEntry): HTMLElement {
  const long = entry.term.length > 28;
  return el(
    'button',
    {
      class: 'word-card',
      attrs: { type: 'button', 'aria-label': `Open details for ${truncate(entry.term, 60)}` },
      on: { click: () => openDrawer(entry.id) },
    },
    [
      el('div', { class: 'word-card-head' }, [
        el('div', {}, [
          el('div', { class: long ? 'word-term is-long' : 'word-term', text: truncate(entry.term, 90) }),
          entry.ipa || entry.phonetic
            ? el('div', { class: 'word-pron', text: entry.ipa || entry.phonetic })
            : null,
        ]),
        el('span', { class: 'badge', attrs: { 'data-status': entry.status }, text: STATUS_LABELS[entry.status] }),
      ]),
      el('div', { class: 'word-meaning', text: entry.contextualMeaning || entry.definition || 'No meaning saved.' }),
      el('div', { class: 'word-foot' }, [
        el('span', { class: 'word-source' }, [
          entry.favorite ? el('span', { class: 'fav', text: '★' }) : null,
          el('span', { text: entry.source?.domain || 'No source saved' }),
        ]),
        el('span', {
          text:
            entry.encounterCount > 1
              ? `${entry.encounterCount}× · ${formatRelativeDate(entry.createdAt)}`
              : formatRelativeDate(entry.createdAt),
        }),
      ]),
    ],
  );
}

/* ------------------------------------------------------------------ */
/* Detail drawer                                                       */
/* ------------------------------------------------------------------ */

function openDrawer(id: string): void {
  const entry = entries.find((item) => item.id === id);
  if (!entry) return;
  openEntryId = id;

  const inner = query('#drawer-inner');
  clear(inner);
  inner.append(...drawerContent(entry));

  query('#drawer').hidden = false;
  query('#scrim').hidden = false;
  query<HTMLElement>('#drawer').focus();
}

function closeDrawer(): void {
  openEntryId = null;
  query('#drawer').hidden = true;
  query('#scrim').hidden = true;
  speechService.cancel();
}

function drawerContent(entry: VocabularyEntry): Node[] {
  const long = entry.term.length > 34;
  const pron = el('div', { class: 'drawer-pron' });
  if (entry.ipa) pron.append(el('span', { class: 'mono', text: entry.ipa }));
  if (entry.phonetic) {
    const phon = el('span', {});
    phon.append(phoneticNodes(entry.phonetic));
    pron.append(phon);
  }
  if (entry.partOfSpeech) pron.append(el('span', { class: 'badge', text: entry.partOfSpeech }));

  const nodes: Node[] = [
    el('div', { class: 'drawer-head' }, [
      el('div', {}, [
        el('div', { class: long ? 'drawer-term is-long' : 'drawer-term', text: entry.term }),
        pron.childElementCount ? pron : null,
      ]),
      el('div', { class: 'drawer-actions' }, [
        el(
          'button',
          {
            class: 'btn',
            attrs: { type: 'button', 'aria-label': 'Listen', title: 'Listen' },
            on: {
              click: () => {
                void speechService
                  .speak(entry.term, { accent: settings.accent, rate: settings.ttsRate, voiceUri: settings.ttsVoiceUri })
                  .catch(() => toast('Speech is not available in this browser.'));
              },
            },
          },
          ['Listen'],
        ),
        el(
          'button',
          {
            class: 'btn',
            attrs: { type: 'button', 'aria-label': 'Close details' },
            on: { click: closeDrawer },
          },
          ['Close'],
        ),
      ]),
    ]),
  ];

  if (entry.contextualMeaning) {
    nodes.push(block('Here it meant', entry.contextualMeaning));
  }
  if (entry.definition && entry.definition !== entry.contextualMeaning) {
    nodes.push(block('Meaning', entry.definition));
  }
  if (entry.synonyms.length) {
    nodes.push(
      el('div', { class: 'block' }, [
        el('span', { class: 'label', text: 'Synonyms' }),
        el('div', { class: 'chip-row' }, entry.synonyms.map((word) => el('span', { class: 'badge', text: word }))),
      ]),
    );
  }
  if (entry.exampleSentence) nodes.push(block('Example', entry.exampleSentence));
  if (entry.tone || entry.register) {
    nodes.push(block('Tone', [entry.tone, entry.register].filter(Boolean).join(' · ')));
  }

  /* Original context — the memory hook. */
  const origin = el('div', { class: 'origin' }, [
    el('span', { class: 'label', text: 'You first saw this while reading' }),
    el('span', { class: 'origin-title', text: entry.source?.title || 'A page you were reading' }),
    entry.originalSentence ? el('blockquote', { text: `“${entry.originalSentence}”` }) : null,
    el('div', { class: 'origin-meta' }, [
      el('span', { text: entry.source?.domain || 'source not saved' }),
      el('span', { text: '·' }),
      el('span', {
        text: new Date(entry.createdAt).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
      }),
      entry.source?.url
        ? el('a', { text: 'View source', attrs: { href: entry.source.url, target: '_blank', rel: 'noreferrer noopener' } })
        : null,
    ]),
  ]);
  nodes.push(origin);

  if (entry.encounterCount > 1) {
    nodes.push(
      el('div', { class: 'block' }, [
        el('span', { class: 'label', text: `Encountered ${entry.encounterCount} times` }),
        el(
          'div',
          { class: 'encounters' },
          entry.encounters.slice(0, 5).map((encounter) =>
            el('div', { class: 'encounter' }, [
              el('span', { text: `“${truncate(encounter.sentence, 140)}”` }),
              el('span', {
                class: 'muted',
                text: `${encounter.domain || 'unknown source'} · ${formatRelativeDate(encounter.at)}`,
              }),
            ]),
          ),
        ),
      ]),
    );
  }

  /* Controls */
  const statusSelect = el(
    'select',
    {
      class: 'select',
      attrs: { 'aria-label': 'Learning status' },
      on: {
        change: (event) => {
          const value = (event.target as HTMLSelectElement).value as LearningStatus;
          void patch(entry.id, { status: value });
        },
      },
    },
    (Object.keys(STATUS_LABELS) as LearningStatus[]).map((status) =>
      el('option', { text: STATUS_LABELS[status], attrs: { value: status, selected: status === entry.status } }),
    ),
  );

  nodes.push(
    el('div', { class: 'block' }, [
      el('span', { class: 'label', text: 'Progress' }),
      el('div', { class: 'status-row' }, [
        statusSelect,
        el(
          'button',
          {
            class: 'btn',
            attrs: { type: 'button', 'aria-pressed': entry.favorite ? 'true' : 'false' },
            on: { click: () => void patch(entry.id, { favorite: !entry.favorite }) },
          },
          [entry.favorite ? '★ Favourite' : '☆ Favourite'],
        ),
        el('span', {
          class: 'muted',
          text:
            entry.review.repetitions > 0
              ? `${entry.review.correctCount} correct · ${entry.review.incorrectCount} missed`
              : 'Not reviewed yet',
        }),
      ]),
    ]),
  );

  const notes = el('textarea', {
    class: 'textarea',
    attrs: { placeholder: 'Your notes — a memory hook, a translation, anything.', 'aria-label': 'Notes' },
  }) as HTMLTextAreaElement;
  notes.value = entry.notes;
  notes.addEventListener('change', () => void patch(entry.id, { notes: notes.value }, false));
  nodes.push(el('div', { class: 'block' }, [el('span', { class: 'label', text: 'Notes' }), notes]));

  nodes.push(
    el('div', { class: 'drawer-foot' }, [
      el(
        'button',
        {
          class: 'btn',
          attrs: { type: 'button' },
          on: {
            click: () => {
              void sendMessage('OPEN_PAGE', { page: 'practice', query: { word: entry.term } });
            },
          },
        },
        ['Practise pronunciation'],
      ),
      el(
        'button',
        {
          class: 'btn',
          attrs: { type: 'button', 'data-variant': 'danger' },
          on: {
            click: () => {
              void (async () => {
                if (!window.confirm(`Delete “${truncate(entry.term, 60)}” from your vocabulary?`)) return;
                await sendMessage('DELETE_ENTRY', { id: entry.id });
                closeDrawer();
                await reload();
                toast('Deleted.');
              })();
            },
          },
        },
        ['Delete'],
      ),
    ]),
  );

  return nodes.filter(Boolean);
}

function block(label: string, text: string): HTMLElement {
  return el('div', { class: 'block' }, [
    el('span', { class: 'label', text: label }),
    el('p', { text }),
  ]);
}

async function patch(id: string, changes: Partial<VocabularyEntry>, reopen = true): Promise<void> {
  await sendMessage('UPDATE_ENTRY', { id, patch: changes });
  await reload();
  if (reopen && openEntryId === id) openDrawer(id);
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

function wire(): void {
  for (const button of queryAll<HTMLButtonElement>('button', query('#collections'))) {
    button.addEventListener('click', () => {
      collection = (button.dataset.collection ?? 'all') as Collection;
      for (const other of queryAll<HTMLButtonElement>('button', query('#collections'))) {
        other.setAttribute('aria-pressed', String(other === button));
      }
      renderGrid();
    });
  }

  for (const button of queryAll<HTMLButtonElement>('button', query('#status-filter'))) {
    button.addEventListener('click', () => {
      statusFilter = (button.dataset.status ?? 'all') as LearningStatus | 'all';
      for (const other of queryAll<HTMLButtonElement>('button', query('#status-filter'))) {
        other.setAttribute('aria-pressed', String(other === button));
      }
      renderGrid();
    });
  }

  const searchInput = query<HTMLInputElement>('#search');
  let debounce = 0;
  searchInput.addEventListener('input', () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      search = searchInput.value;
      renderGrid();
    }, 140);
  });

  query('#start-review').addEventListener('click', () => {
    location.href = '../review/review.html';
  });

  query('#scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && openEntryId) closeDrawer();
    if (event.key === '/' && document.activeElement !== searchInput) {
      event.preventDefault();
      searchInput.focus();
    }
  });
}

void main().catch((error: unknown) => {
  toast(error instanceof Error ? error.message : 'Could not load your vocabulary.');
});
