import { createScorer } from '@/services/pronunciation-service';
import { speechService } from '@/services/speech-service';
import { MOCK_WORDS } from '@/services/mock-lexicon';
import { ClariError } from '@/shared/errors';
import { sendMessage } from '@/shared/messaging';
import { normalizeTerm, parsePhonetic } from '@/shared/text';
import { clear, el, initPage, phoneticNodes, query, toast } from '@/ui/page';
import type { PronunciationScore, Settings, VocabularyEntry } from '@/types';

/**
 * Pronunciation practice.
 *
 * The microphone is requested here — an extension page with its own origin —
 * rather than from a content script on someone else's site, so the permission
 * prompt names ClariWord and the grant is remembered for this page only.
 */

interface Target {
  word: string;
  ipa: string;
  phonetic: string;
}

let settings: Settings;
let target: Target | null = null;
let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let chunks: BlobPart[] = [];
let recording: Blob | null = null;
let audioContext: AudioContext | null = null;
let meterFrame = 0;
let startedAt = 0;
let timerHandle = 0;

async function main(): Promise<void> {
  settings = await initPage();
  wire();
  updateScoringAvailability();

  const requested = new URLSearchParams(location.search).get('word');
  if (requested) {
    query<HTMLInputElement>('#word-input').value = requested;
    await loadTarget(requested);
  }
}

/* ------------------------------------------------------------------ */
/* Target word                                                         */
/* ------------------------------------------------------------------ */

async function loadTarget(text: string): Promise<void> {
  const word = text.trim();
  if (!word) return;

  const next: Target = { word, ipa: '', phonetic: '' };

  // Prefer what the user already saved, then the built-in lexicon.
  const saved = await findSaved(word);
  if (saved) {
    next.ipa = saved.ipa;
    next.phonetic = saved.phonetic;
  } else {
    const entry = MOCK_WORDS[normalizeTerm(word)];
    if (entry) {
      next.ipa = entry.ipa[settings.accent];
      next.phonetic = entry.phonetic;
    }
  }

  target = next;
  renderTarget();
}

async function findSaved(word: string): Promise<VocabularyEntry | null> {
  const entries = await sendMessage('LIST_VOCABULARY', { search: word, limit: 5 });
  const normalized = normalizeTerm(word);
  return entries.find((entry) => entry.normalized === normalized) ?? null;
}

function renderTarget(): void {
  if (!target) return;
  query('#target').hidden = false;
  query('#target-word').textContent = target.word;
  query('#target-ipa').textContent = target.ipa;

  const phonetic = query('#target-phonetic');
  clear(phonetic);
  if (target.phonetic) phonetic.append(phoneticNodes(target.phonetic));

  const { syllables, stressIndex } = parsePhonetic(target.phonetic);
  query('#stress-note').textContent =
    stressIndex >= 0 && syllables[stressIndex]
      ? `Stress the “${syllables[stressIndex]}” syllable — say it slightly longer and louder.`
      : target.phonetic
        ? 'Say each syllable evenly.'
        : 'No pronunciation guide is saved for this word yet. Listen first, then repeat.';

  query<HTMLButtonElement>('#record').disabled = false;
  updateScoringAvailability();
}

/* ------------------------------------------------------------------ */
/* Recording                                                           */
/* ------------------------------------------------------------------ */

async function startRecording(): Promise<void> {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    toast('Microphone access was denied. Allow it to record your pronunciation.');
    query('#mic-note').textContent =
      'Microphone access was denied. Chrome remembers this choice — reset it from the padlock icon in the address bar.';
    return;
  }

  chunks = [];
  recording = null;
  recorder = new MediaRecorder(stream);
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  recorder.addEventListener('stop', onRecordingStopped);
  recorder.start();

  startedAt = Date.now();
  timerHandle = window.setInterval(() => {
    const seconds = (Date.now() - startedAt) / 1000;
    query('#timer').textContent = `${seconds.toFixed(1)}s`;
    if (seconds > 15) void stopRecording();
  }, 100);

  startMeter(stream);
  const button = query<HTMLButtonElement>('#record');
  button.dataset.recording = 'true';
  query('#record-label').textContent = 'Stop';
  query('#playback').hidden = true;
}

async function stopRecording(): Promise<void> {
  if (!recorder || recorder.state === 'inactive') return;
  recorder.stop();
}

function onRecordingStopped(): void {
  window.clearInterval(timerHandle);
  stopMeter();
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;

  recording = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
  recorder = null;

  const button = query<HTMLButtonElement>('#record');
  button.dataset.recording = 'false';
  query('#record-label').textContent = 'Record again';

  const audio = query<HTMLAudioElement>('#audio');
  if (audio.src) URL.revokeObjectURL(audio.src);
  audio.src = URL.createObjectURL(recording);
  query('#playback').hidden = false;
  updateScoringAvailability();
}

function startMeter(source: MediaStream): void {
  audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  audioContext.createMediaStreamSource(source).connect(analyser);
  const buffer = new Uint8Array(analyser.frequencyBinCount);
  const fill = query('#meter-fill');

  const tick = (): void => {
    analyser.getByteTimeDomainData(buffer);
    let peak = 0;
    for (const sample of buffer) peak = Math.max(peak, Math.abs(sample - 128));
    fill.style.width = `${Math.min(100, (peak / 128) * 180)}%`;
    meterFrame = requestAnimationFrame(tick);
  };
  tick();
}

function stopMeter(): void {
  if (meterFrame) cancelAnimationFrame(meterFrame);
  meterFrame = 0;
  query('#meter-fill').style.width = '0%';
  void audioContext?.close();
  audioContext = null;
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

function updateScoringAvailability(): void {
  const simulator = query<HTMLInputElement>('#use-simulator').checked;
  const backendReady = settings.aiMode === 'backend' && !!settings.backendUrl.trim();

  query('#score-availability').textContent = simulator
    ? 'Dev simulator selected. It produces placeholder numbers to exercise the interface — it does not listen to your recording.'
    : backendReady
      ? `Recordings are sent to ${hostOf(settings.backendUrl)}/api/pronunciation for scoring. Nothing is stored by the extension.`
      : 'Real scoring needs a speech backend. Configure one in Settings, or tick the dev simulator to see the interface.';

  query<HTMLButtonElement>('#score').disabled = !recording || (!simulator && !backendReady);
}

async function runScoring(): Promise<void> {
  if (!recording || !target) return;
  const useSimulator = query<HTMLInputElement>('#use-simulator').checked;
  const scorer = createScorer(settings, useSimulator);
  const button = query<HTMLButtonElement>('#score');
  button.disabled = true;
  button.textContent = 'Scoring…';

  try {
    const score = await scorer.score({
      word: target.word,
      phonetic: target.phonetic,
      ipa: target.ipa,
      audio: recording,
      accent: settings.accent,
    });
    renderScore(score);
  } catch (error) {
    const clari = ClariError.from(error);
    const result = query('#result');
    result.hidden = false;
    clear(result);
    result.append(el('p', { class: 'unavailable', text: clari.message }));
    if (clari.hint) result.append(el('p', { class: 'muted', text: clari.hint }));
  } finally {
    button.disabled = false;
    button.textContent = 'Score my pronunciation';
  }
}

function renderScore(score: PronunciationScore): void {
  const result = query('#result');
  result.hidden = false;
  clear(result);

  if (score.simulated) {
    result.append(
      el('div', {
        class: 'result-banner',
        attrs: { 'data-simulated': 'true' },
        text: 'Simulated output — these numbers are generated to exercise the interface and say nothing about how you actually sounded.',
      }),
    );
  }

  result.append(
    el('div', { class: 'result-head' }, [
      el('span', { class: 'result-score', text: `${score.overall}` }),
      el('span', { class: 'muted', text: '/ 100' }),
      el('span', { class: 'badge', text: score.stressCorrect ? 'Stress: correct' : 'Stress: needs work' }),
    ]),
  );

  if (score.perSyllable.length) {
    result.append(
      el(
        'div',
        { class: 'syllables' },
        score.perSyllable.map((item) =>
          el('div', { class: 'syllable' }, [
            el('span', { class: 'syllable-name', text: item.syllable }),
            el('span', { class: 'syllable-bar' }, [el('i', { attrs: { style: `width:${item.score}%` } })]),
            el('span', { class: 'syllable-score', text: `${item.score}` }),
          ]),
        ),
      ),
    );
  }
  if (score.transcript) {
    result.append(el('p', { class: 'muted', text: `Heard: “${score.transcript}”` }));
  }
  if (score.feedback) {
    result.append(el('p', { text: score.feedback }));
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

function wire(): void {
  const input = query<HTMLInputElement>('#word-input');
  query('#load-word').addEventListener('click', () => void loadTarget(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void loadTarget(input.value);
  });

  query('#listen').addEventListener('click', () => void speak(settings.ttsRate));
  query('#listen-slow').addEventListener('click', () => void speak(0.62));

  query('#record').addEventListener('click', () => {
    void (recorder && recorder.state === 'recording' ? stopRecording() : startRecording());
  });
  query('#rerecord').addEventListener('click', () => void startRecording());

  query('#compare').addEventListener('click', () => {
    void (async () => {
      await speak(0.8);
      window.setTimeout(() => void query<HTMLAudioElement>('#audio').play(), 1400);
    })();
  });

  query<HTMLInputElement>('#use-simulator').addEventListener('change', updateScoringAvailability);
  query('#score').addEventListener('click', () => void runScoring());

  window.addEventListener('pagehide', () => {
    stream?.getTracks().forEach((track) => track.stop());
    speechService.cancel();
  });
}

async function speak(rate: number): Promise<void> {
  if (!target) return;
  try {
    await speechService.speak(target.word, {
      accent: settings.accent,
      rate,
      voiceUri: settings.ttsVoiceUri,
    });
  } catch {
    toast('Speech is not available in this browser.');
  }
}

void main().catch((error: unknown) => {
  toast(error instanceof Error ? error.message : 'Could not open practice.');
});
