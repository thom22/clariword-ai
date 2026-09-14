import { Errors } from '@/shared/errors';
import type { Accent } from '@/types';

/**
 * Text-to-speech over the Web Speech API.
 *
 * Works in the content script and in extension pages. Voice availability is
 * a property of the user's OS, so everything here degrades to a clear error
 * rather than pretending to speak.
 */

export type SpeechState = 'idle' | 'speaking' | 'paused';

const LANG_BY_ACCENT: Record<Accent, string> = {
  american: 'en-US',
  british: 'en-GB',
};

export interface SpeakOptions {
  accent?: Accent;
  rate?: number;
  voiceUri?: string;
  onStateChange?: (state: SpeechState) => void;
}

class SpeechService {
  private voices: SpeechSynthesisVoice[] = [];
  private voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;
  private listeners = new Set<(state: SpeechState) => void>();

  get supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  /** Voices arrive asynchronously in Chrome; resolve once they exist. */
  async getVoices(): Promise<SpeechSynthesisVoice[]> {
    if (!this.supported) return [];
    if (this.voices.length) return this.voices;
    if (!this.voicesReady) {
      this.voicesReady = new Promise((resolve) => {
        const read = (): boolean => {
          const list = window.speechSynthesis.getVoices();
          if (list.length) {
            this.voices = list;
            resolve(list);
            return true;
          }
          return false;
        };
        if (read()) return;
        const handler = (): void => {
          if (read()) window.speechSynthesis.removeEventListener('voiceschanged', handler);
        };
        window.speechSynthesis.addEventListener('voiceschanged', handler);
        // Chrome sometimes never fires the event on a cold profile.
        setTimeout(() => {
          read();
          resolve(this.voices);
        }, 1200);
      });
    }
    return this.voicesReady;
  }

  async pickVoice(accent: Accent, preferredUri = ''): Promise<SpeechSynthesisVoice | null> {
    const voices = await this.getVoices();
    if (!voices.length) return null;
    if (preferredUri) {
      const exact = voices.find((voice) => voice.voiceURI === preferredUri);
      if (exact) return exact;
    }
    const lang = LANG_BY_ACCENT[accent];
    const sameLocale = voices.filter((voice) => voice.lang.replace('_', '-') === lang);
    // Prefer a local (offline, lower-latency) voice, then any matching locale.
    return (
      sameLocale.find((voice) => voice.localService) ??
      sameLocale[0] ??
      voices.find((voice) => voice.lang.toLowerCase().startsWith('en')) ??
      voices[0] ??
      null
    );
  }

  async speak(text: string, options: SpeakOptions = {}): Promise<void> {
    if (!this.supported) throw Errors.speechUnavailable();
    const trimmed = text.trim();
    if (!trimmed) return;

    this.cancel();
    const utterance = new SpeechSynthesisUtterance(trimmed.slice(0, 1000));
    const voice = await this.pickVoice(options.accent ?? 'american', options.voiceUri ?? '');
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = LANG_BY_ACCENT[options.accent ?? 'american'];
    }
    utterance.rate = options.rate ?? 0.95;

    utterance.addEventListener('start', () => this.emit('speaking', options));
    utterance.addEventListener('end', () => this.emit('idle', options));
    utterance.addEventListener('error', () => this.emit('idle', options));

    window.speechSynthesis.speak(utterance);

    // Chrome pauses long utterances when the worker sleeps; nudge it awake.
    if (trimmed.length > 180) this.keepAlive();
  }

  pause(): void {
    if (!this.supported) return;
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.pause();
      this.emit('paused');
    }
  }

  resume(): void {
    if (!this.supported) return;
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      this.emit('speaking');
    }
  }

  cancel(): void {
    if (!this.supported) return;
    window.speechSynthesis.cancel();
    this.emit('idle');
  }

  get state(): SpeechState {
    if (!this.supported) return 'idle';
    if (window.speechSynthesis.paused) return 'paused';
    return window.speechSynthesis.speaking ? 'speaking' : 'idle';
  }

  onStateChange(listener: (state: SpeechState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(state: SpeechState, options?: SpeakOptions): void {
    options?.onStateChange?.(state);
    for (const listener of this.listeners) listener(state);
  }

  private keepAlive(): void {
    const timer = setInterval(() => {
      if (!window.speechSynthesis.speaking) {
        clearInterval(timer);
        return;
      }
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    }, 9_000);
  }
}

export const speechService = new SpeechService();
