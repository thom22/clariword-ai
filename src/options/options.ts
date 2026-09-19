import { describeOutgoingPayload } from '@/services/ai-service';
import { speechService } from '@/services/speech-service';
import { localStore } from '@/services/storage-service';
import { DEFAULT_SETTINGS } from '@/shared/defaults';
import { sendMessage } from '@/shared/messaging';
import { applyTheme, initPage, query, queryAll, segmented, toast } from '@/ui/page';
import type { Accent, ExplanationLevel, HelperMode, PageContext, Settings, ThemePreference } from '@/types';

/** Settings page. Every control writes through to storage immediately. */

const LEVEL_HINTS: Record<ExplanationLevel, string> = {
  beginner: 'Very simple explanations, short sentences, few extra details.',
  intermediate: 'Clear explanations with the vocabulary details most readers want.',
  advanced: 'Adds nuance, register, grammar and the author’s likely intent.',
};

/** A representative selection, used only to preview what would be transmitted. */
const SAMPLE_CONTEXT: PageContext = {
  selectedText: 'ostensibly',
  sentence: "The policy's ostensibly pragmatic approach belies a deeper ideological shift.",
  previousSentence: 'Ministers announced the change on Tuesday.',
  nextSentence: 'Critics were quick to respond.',
  pageTitle: 'Why AI regulation is becoming more complicated',
  pageUrl: 'https://example.com/article',
  pageDomain: 'example.com',
};

let settings: Settings;

async function main(): Promise<void> {
  settings = await initPage();
  query('#version').textContent = __VERSION__;

  if (new URLSearchParams(location.search).get('welcome') === '1') {
    query('#welcome').hidden = false;
  }
  query('#dismiss-welcome').addEventListener('click', () => {
    query('#welcome').hidden = true;
  });

  bindSwitches();
  bindSegments();
  bindInputs();
  bindBackend();
  bindDataTools();
  // Paint the settings straight away; voice discovery can take a second.
  render();
  await populateVoices();
}

async function update(patch: Partial<Settings>): Promise<void> {
  settings = await sendMessage('UPDATE_SETTINGS', patch);
  render();
}

function render(): void {
  for (const input of queryAll<HTMLInputElement>('input[type="checkbox"][id]')) {
    const key = input.id as keyof Settings;
    if (typeof settings[key] === 'boolean') input.checked = settings[key] as boolean;
  }
  query<HTMLInputElement>('#maxSelectionChars').value = String(settings.maxSelectionChars);
  query<HTMLInputElement>('#ttsRate').value = String(settings.ttsRate);
  query('#rate-value').textContent = settings.ttsRate.toFixed(2);
  query<HTMLTextAreaElement>('#disabledDomains').value = settings.disabledDomains.join('\n');
  query('#level-hint').textContent = LEVEL_HINTS[settings.explanationLevel];
  query('#mode-hint').textContent =
    settings.aiMode === 'mock'
      ? 'Offline fallback — the hosted service could not be reached.'
      : 'Explanations come from the ClariWord service.';
  query('#privacy-preview').textContent = `A lookup currently sends: ${describeOutgoingPayload(SAMPLE_CONTEXT, settings)}. Nothing else leaves your browser.`;
  applyTheme(settings.theme);
}

function bindSwitches(): void {
  const keys: (keyof Settings)[] = [
    'enabled',
    'autoHelper',
    'autoPlayPronunciation',
    'saveSourcePage',
    'sendNeighbouringContext',
    'sendPageMetadata',
  ];
  for (const key of keys) {
    query<HTMLInputElement>(`#${key}`).addEventListener('change', (event) => {
      void update({ [key]: (event.target as HTMLInputElement).checked } as Partial<Settings>);
    });
  }
}

function bindSegments(): void {
  segmented(query('#helperMode'), settings.helperMode, (value) => {
    void update({ helperMode: value as HelperMode });
  });
  segmented(query('#theme'), settings.theme, (value) => {
    void update({ theme: value as ThemePreference });
  });
  segmented(query('#explanationLevel'), settings.explanationLevel, (value) => {
    void update({ explanationLevel: value as ExplanationLevel });
  });
  segmented(query('#accent'), settings.accent, (value) => {
    void update({ accent: value as Accent });
    void populateVoices();
  });
}

function bindInputs(): void {
  const rate = query<HTMLInputElement>('#ttsRate');
  rate.addEventListener('input', () => {
    query('#rate-value').textContent = Number(rate.value).toFixed(2);
  });
  rate.addEventListener('change', () => void update({ ttsRate: Number(rate.value) }));

  const max = query<HTMLInputElement>('#maxSelectionChars');
  max.addEventListener('change', () => void update({ maxSelectionChars: Number(max.value) }));

  const domains = query<HTMLTextAreaElement>('#disabledDomains');
  domains.addEventListener('change', () => {
    void update({ disabledDomains: domains.value.split('\n').map((d) => d.trim()).filter(Boolean) });
  });

  query<HTMLSelectElement>('#ttsVoiceUri').addEventListener('change', (event) => {
    void update({ ttsVoiceUri: (event.target as HTMLSelectElement).value });
  });

  query('#test-voice').addEventListener('click', () => {
    void speechService
      .speak('ostensibly pragmatic', {
        accent: settings.accent,
        rate: settings.ttsRate,
        voiceUri: settings.ttsVoiceUri,
      })
      .catch(() => toast('Speech is not available in this browser.'));
  });
}

async function populateVoices(): Promise<void> {
  const select = query<HTMLSelectElement>('#ttsVoiceUri');
  const voices = await speechService.getVoices();
  const english = voices.filter((voice) => voice.lang.toLowerCase().startsWith('en'));
  select.replaceChildren();

  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = english.length ? 'Automatic (match accent)' : 'No voices installed';
  select.append(auto);

  for (const voice of english) {
    const option = document.createElement('option');
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} — ${voice.lang}${voice.localService ? '' : ' (online)'}`;
    select.append(option);
  }
  select.value = settings.ttsVoiceUri;
  select.disabled = english.length === 0;
  query('#voice-hint').textContent = english.length
    ? `${english.length} English voice${english.length === 1 ? '' : 's'} available from your system.`
    : 'No English voices are installed on this system, so audio is unavailable.';
}

/* ------------------------------------------------------------------ */
/* Backend                                                             */
/* ------------------------------------------------------------------ */

function bindBackend(): void {
  // Nothing to configure: the service is preconfigured. Report whether it is
  // reachable so a failure is visible rather than silent.
  void checkService();
}

async function checkService(): Promise<void> {
  setStatus('pending', 'Checking…');
  try {
    const base = settings.backendUrl.replace(/\/+$/, '');
    const response = await fetch(new URL('/api/health', `${base}/`).toString());
    if (!response.ok) {
      setStatus('error', `The ClariWord service returned ${response.status}. Demo mode will be used until it recovers.`);
      return;
    }
    setStatus('ok', 'Connected to the ClariWord service.');
  } catch {
    setStatus('error', 'Could not reach the ClariWord service. Demo mode will be used until it recovers.');
  }
}

function setStatus(state: 'ok' | 'error' | 'pending', message: string): void {
  const node = query('#backend-status');
  node.dataset.state = state;
  node.textContent = message;
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

function bindDataTools(): void {
  void showStorageUsage();

  query('#export-data').addEventListener('click', () => {
    void (async () => {
      const entries = await sendMessage('LIST_VOCABULARY', { sort: 'recent' });
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), version: __VERSION__, settings, entries }, null, 2)], {
        type: 'application/json',
      });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `clariword-vocabulary-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 5_000);
      toast(`Exported ${entries.length} saved item${entries.length === 1 ? '' : 's'}.`);
    })();
  });

  query('#clear-data').addEventListener('click', () => {
    void (async () => {
      const stats = await sendMessage('GET_STATS');
      const confirmed = window.confirm(
        `Delete ${stats.totalSaved} saved word${stats.totalSaved === 1 ? '' : 's'} and all local statistics?\n\nThis cannot be undone. Your settings are kept.`,
      );
      if (!confirmed) return;
      const { deleted } = await sendMessage('CLEAR_VOCABULARY');
      toast(`Cleared ${deleted} saved item${deleted === 1 ? '' : 's'}.`);
      await showStorageUsage();
    })();
  });

  query('#reset').addEventListener('click', () => {
    void (async () => {
      if (!window.confirm('Reset all ClariWord settings to their defaults? Saved vocabulary is kept.')) return;
      settings = await sendMessage('UPDATE_SETTINGS', DEFAULT_SETTINGS);
      render();
      for (const group of ['#helperMode', '#theme', '#explanationLevel', '#accent']) {
        for (const button of queryAll<HTMLButtonElement>('button', query(group))) {
          const key = group.slice(1) as keyof Settings;
          button.setAttribute('aria-pressed', String(button.dataset.value === String(settings[key])));
        }
      }
      toast('Settings reset.');
    })();
  });
}

async function showStorageUsage(): Promise<void> {
  const [bytes, stats] = await Promise.all([
    localStore.bytesInUse?.() ?? Promise.resolve(null),
    sendMessage('GET_STATS'),
  ]);
  const size = bytes === null ? '' : ` · about ${(bytes / 1024).toFixed(1)} KB`;
  query('#storage-note').textContent =
    `${stats.totalSaved} saved item${stats.totalSaved === 1 ? '' : 's'}, daily counts and these settings${size}. Nothing is uploaded.`;
}

void main().catch((error: unknown) => {
  toast(error instanceof Error ? error.message : 'Could not load settings.');
});
