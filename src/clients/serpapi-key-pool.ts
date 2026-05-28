/**
 * SerpApiKeyPool
 *
 * Manages multiple SerpAPI keys with month-scoped exhaustion.
 * When a key triggers a rate-limit error (HTTP 429 or SerpAPI quota error),
 * it is marked as exhausted for the remainder of the current calendar month.
 * The pool then automatically falls through to the next available key.
 */

export interface SerpApiKeyPoolOptions {
  keys: string[];
  /** Override current month string (YYYY-MM) for testing */
  currentMonthOverride?: string;
}

export class SerpApiKeyPool {
  private readonly keys: string[];
  private readonly exhaustedUntil: Map<string, string> = new Map();
  private currentMonthOverride?: string;

  constructor(options: SerpApiKeyPoolOptions) {
    if (options.keys.length === 0) {
      throw new Error("SerpApiKeyPool requires at least one API key");
    }
    this.keys = [...options.keys];
    this.currentMonthOverride = options.currentMonthOverride;
  }

  /** Returns the current active key, skipping exhausted ones. */
  getActiveKey(): string {
    const month = this.currentMonth();
    const active = this.keys.find((k) => this.exhaustedUntil.get(k) !== month);
    if (!active) {
      throw new Error(
        `[serpapi-key-pool] All ${this.keys.length} API key(s) are exhausted for ${month}. ` +
        `Add more keys via SERPAPI_API_KEYS or wait until next month.`
      );
    }
    return active;
  }

  /**
   * Mark a key as exhausted for the current month.
   * Call this when a request returns HTTP 429 or a SerpAPI quota error body.
   */
  markExhausted(key: string): void {
    const month = this.currentMonth();
    console.warn(
      `[serpapi-key-pool] Key ...${key.slice(-6)} exhausted for ${month}, switching to next key`
    );
    this.exhaustedUntil.set(key, month);
  }

  isExhausted(key: string): boolean {
    return this.exhaustedUntil.get(key) === this.currentMonth();
  }

  get keyCount(): number {
    return this.keys.length;
  }

  get availableKeyCount(): number {
    const month = this.currentMonth();
    return this.keys.filter((k) => this.exhaustedUntil.get(k) !== month).length;
  }

  private currentMonth(): string {
    if (this.currentMonthOverride) return this.currentMonthOverride;
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
}

export function parseSerpApiKeys(input: string): string[] {
  return input
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}
