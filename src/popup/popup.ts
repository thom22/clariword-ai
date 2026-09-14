import { sendMessage } from '@/shared/messaging';
import { initPage, plural, query, segmented } from '@/ui/page';
import type { Accent, ExplanationLevel, Settings } from '@/types';

/** Toolbar popup: status at a glance plus the three settings people change most. */

async function main(): Promise<void> {
  const settings = await initPage();
  render(settings);
  wire(settings);
  await refreshStats();
}

function render(settings: Settings): void {
  query<HTMLInputElement>('#enabled').checked = settings.enabled;
  query<HTMLInputElement>('#auto-helper').checked = settings.autoHelper;
  query('#helper-hint').textContent =
    settings.helperMode === 'toolbar' ? 'Shows the quick-action toolbar' : 'Shows a small ClariWord button';
  query('#mode-note').textContent =
    settings.aiMode === 'mock' ? 'Demo mode — no backend configured' : `Connected to ${hostOf(settings.backendUrl)}`;
  query('#version').textContent = `v${__VERSION__}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function wire(settings: Settings): void {
  let current = settings;

  const update = async (patch: Partial<Settings>): Promise<void> => {
    current = await sendMessage('UPDATE_SETTINGS', patch);
    render(current);
  };

  query<HTMLInputElement>('#enabled').addEventListener('change', (event) => {
    void update({ enabled: (event.target as HTMLInputElement).checked });
  });
  query<HTMLInputElement>('#auto-helper').addEventListener('change', (event) => {
    void update({ autoHelper: (event.target as HTMLInputElement).checked });
  });

  segmented(query('#level'), current.explanationLevel, (value) => {
    void update({ explanationLevel: value as ExplanationLevel });
  });
  segmented(query('#accent'), current.accent, (value) => {
    void update({ accent: value as Accent });
  });

  query('#open-vocabulary').addEventListener('click', () => {
    void sendMessage('OPEN_PAGE', { page: 'vocabulary' }).then(() => window.close());
  });
  query('#open-review').addEventListener('click', () => {
    void sendMessage('OPEN_PAGE', { page: 'review' }).then(() => window.close());
  });
  query('#open-options').addEventListener('click', () => {
    void sendMessage('OPEN_PAGE', { page: 'options' }).then(() => window.close());
  });
}

async function refreshStats(): Promise<void> {
  const stats = await sendMessage('GET_STATS');
  query('#stat-today').textContent = String(stats.today.lookups);
  query('#stat-saved').textContent = String(stats.totalSaved);
  query('#stat-due').textContent = String(stats.dueForReview);

  const streak = query('#streak');
  if (stats.streakDays >= 2) {
    streak.textContent = `${plural(stats.streakDays, 'day')} in a row — ${plural(stats.byStatus.mastered, 'word')} mastered.`;
    streak.hidden = false;
  } else {
    streak.hidden = true;
  }

  const reviewButton = query<HTMLButtonElement>('#open-review');
  reviewButton.textContent =
    stats.dueForReview > 0 ? `Review ${plural(stats.dueForReview, 'word')}` : 'Review vocabulary';
  reviewButton.disabled = stats.totalSaved === 0;
}

void main().catch((error: unknown) => {
  query('#mode-note').textContent = error instanceof Error ? error.message : 'Something went wrong.';
});
