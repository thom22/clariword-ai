import { STORAGE_KEYS } from '@/shared/constants';
import { localDateKey } from '@/shared/text';
import { localStore, WriteQueue, type KeyValueStore } from '@/services/storage-service';
import type { DailyStats, StatsSummary } from '@/types';
import { vocabularyRepository, type VocabularyRepository } from '@/services/vocabulary-service';

const RETAIN_DAYS = 120;

interface StatsBlob {
  days: Record<string, DailyStats>;
}

function emptyDay(date: string): DailyStats {
  return { date, lookups: 0, saves: 0, reviewsAnswered: 0, reviewsCorrect: 0 };
}

/** Counts of what the user did, kept locally and never transmitted. */
export class StatsService {
  private queue = new WriteQueue();

  constructor(
    private readonly store: KeyValueStore = localStore,
    private readonly vocabulary: VocabularyRepository = vocabularyRepository,
  ) {}

  private async load(): Promise<StatsBlob> {
    const stored = await this.store.get<StatsBlob>(STORAGE_KEYS.stats);
    if (!stored || typeof stored !== 'object' || typeof stored.days !== 'object') return { days: {} };
    return stored;
  }

  async increment(field: keyof Omit<DailyStats, 'date'>, by = 1, date = localDateKey()): Promise<void> {
    await this.queue.run(async () => {
      const blob = await this.load();
      const day = blob.days[date] ?? emptyDay(date);
      day[field] += by;
      blob.days[date] = day;
      this.prune(blob);
      await this.store.set({ [STORAGE_KEYS.stats]: blob });
    });
  }

  private prune(blob: StatsBlob): void {
    const keys = Object.keys(blob.days).sort();
    while (keys.length > RETAIN_DAYS) {
      const oldest = keys.shift();
      if (oldest) delete blob.days[oldest];
    }
  }

  async today(): Promise<DailyStats> {
    const blob = await this.load();
    const key = localDateKey();
    return blob.days[key] ?? emptyDay(key);
  }

  async history(days = 14): Promise<DailyStats[]> {
    const blob = await this.load();
    const out: DailyStats[] = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = localDateKey(d);
      out.push(blob.days[key] ?? emptyDay(key));
    }
    return out;
  }

  /**
   * Consecutive active days. A day counts as active if the user looked up,
   * saved or reviewed anything. Today not having started yet does not break
   * the streak, so we begin counting from the most recent active day.
   */
  async streak(): Promise<number> {
    const blob = await this.load();
    const isActive = (date: Date): boolean => {
      const day = blob.days[localDateKey(date)];
      return !!day && day.lookups + day.saves + day.reviewsAnswered > 0;
    };

    const cursor = new Date();
    if (!isActive(cursor)) cursor.setDate(cursor.getDate() - 1);

    let streak = 0;
    for (let i = 0; i < RETAIN_DAYS && isActive(cursor); i += 1) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  async summary(): Promise<StatsSummary> {
    const [today, byStatus, due, all, streakDays] = await Promise.all([
      this.today(),
      this.vocabulary.countsByStatus(),
      this.vocabulary.due(),
      this.vocabulary.all(),
      this.streak(),
    ]);
    return {
      today,
      totalSaved: all.length,
      dueForReview: due.length,
      streakDays,
      byStatus,
    };
  }

  async clear(): Promise<void> {
    await this.store.remove([STORAGE_KEYS.stats]);
  }
}

export const statsService = new StatsService();
