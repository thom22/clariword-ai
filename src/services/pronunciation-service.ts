import { Errors } from '@/shared/errors';
import { parsePhonetic, stableId } from '@/shared/text';
import type { PronunciationScore, Settings } from '@/types';

/**
 * Pronunciation scoring.
 *
 * Real scoring needs a speech model; the browser cannot do it. So this module
 * defines the interface and ships two implementations:
 *
 *  - `BackendScorer` posts the recording to your configured backend.
 *  - `SimulatedScorer` is a development stand-in. It always reports
 *    `simulated: true`, and the UI labels its output as not an assessment of
 *    how you actually sounded. Nothing here ever invents a real score.
 */

export interface ScoreRequest {
  word: string;
  phonetic: string;
  ipa: string;
  audio: Blob;
  accent: Settings['accent'];
}

export interface PronunciationScorer {
  readonly id: string;
  readonly available: boolean;
  score(request: ScoreRequest): Promise<PronunciationScore>;
}

export class BackendScorer implements PronunciationScorer {
  readonly id = 'backend';

  constructor(private readonly settings: Settings) {}

  get available(): boolean {
    return this.settings.aiMode === 'backend' && !!this.settings.backendUrl.trim();
  }

  async score(request: ScoreRequest): Promise<PronunciationScore> {
    if (!this.available) throw Errors.scoringUnavailable();

    const base = this.settings.backendUrl.trim().replace(/\/+$/, '');
    const form = new FormData();
    form.append('audio', request.audio, 'recording.webm');
    form.append('word', request.word);
    form.append('phonetic', request.phonetic);
    form.append('ipa', request.ipa);
    form.append('accent', request.accent);

    let response: Response;
    try {
      response = await fetch(`${base}/api/pronunciation`, {
        method: 'POST',
        body: form,
        headers: this.settings.backendToken ? { authorization: `Bearer ${this.settings.backendToken}` } : {},
      });
    } catch {
      throw Errors.backendUnreachable(base);
    }
    if (response.status === 404) throw Errors.scoringUnavailable();
    if (!response.ok) throw Errors.backendError(response.status);

    const raw: unknown = await response.json().catch(() => null);
    return validateScore(raw);
  }
}

/**
 * Development stand-in. Produces a deterministic, obviously-synthetic report
 * so the UI can be built and demoed without a speech backend.
 */
export class SimulatedScorer implements PronunciationScorer {
  readonly id = 'simulated';
  readonly available = true;

  async score(request: ScoreRequest): Promise<PronunciationScore> {
    await new Promise((resolve) => setTimeout(resolve, 700));
    const { syllables, stressIndex } = parsePhonetic(request.phonetic || request.word);
    const seed = Number.parseInt(stableId(request.word).slice(0, 6), 36);

    const perSyllable = (syllables.length ? syllables : [request.word]).map((syllable, index) => ({
      syllable,
      score: 68 + ((seed >> (index * 3)) % 30),
    }));
    const overall = Math.round(perSyllable.reduce((sum, item) => sum + item.score, 0) / perSyllable.length);
    const weakest = perSyllable.reduce((min, item) => (item.score < min.score ? item : min), perSyllable[0]!);

    return {
      overall,
      stressCorrect: stressIndex !== -1 && weakest.syllable !== syllables[stressIndex],
      transcript: request.word,
      feedback: `Simulated result — this is placeholder output, not an assessment of your recording. Connect a speech backend for real scoring. (The simulator would have pointed at “${weakest.syllable}”.)`,
      perSyllable,
      simulated: true,
    };
  }
}

function validateScore(raw: unknown): PronunciationScore {
  if (typeof raw !== 'object' || raw === null) throw Errors.invalidResponse('scoring response was not an object');
  const value = raw as Record<string, unknown>;
  const overall = typeof value.overall === 'number' ? Math.max(0, Math.min(100, Math.round(value.overall))) : NaN;
  if (Number.isNaN(overall)) throw Errors.invalidResponse('scoring response had no numeric "overall"');

  const perSyllable = Array.isArray(value.perSyllable)
    ? value.perSyllable
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .map((item) => ({
          syllable: String(item.syllable ?? ''),
          score: typeof item.score === 'number' ? Math.max(0, Math.min(100, Math.round(item.score))) : 0,
        }))
        .filter((item) => item.syllable)
    : [];

  return {
    overall,
    stressCorrect: value.stressCorrect === true,
    transcript: typeof value.transcript === 'string' ? value.transcript : '',
    feedback: typeof value.feedback === 'string' ? value.feedback : '',
    perSyllable,
    simulated: false,
  };
}

export function createScorer(settings: Settings, useSimulator: boolean): PronunciationScorer {
  if (useSimulator) return new SimulatedScorer();
  return new BackendScorer(settings);
}
