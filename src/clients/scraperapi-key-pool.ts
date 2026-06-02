/**
 * ScraperAPI Key Pool
 * 
 * Manages multiple ScraperAPI keys and rotates them when quota is exhausted.
 * Similar to SerpAPI key pool implementation.
 */

export interface ScraperApiKeyPool {
  /**
   * Get the next available ScraperAPI key.
   * @returns The API key, or null if all keys are exhausted for this month.
   */
  getNextKey(): string | null;

  /**
   * Mark a key as exhausted for the current month.
   * @param key The API key that has run out of quota.
   */
  markKeyExhausted(key: string): void;

  /**
   * Get statistics about the key pool.
   */
  getStats(): {
    totalKeys: number;
    availableKeys: number;
    exhaustedKeys: number;
  };
}

interface KeyState {
  key: string;
  exhaustedMonth: string | null; // Format: "YYYY-MM"
}

/**
 * Create a ScraperAPI key pool from environment variable.
 * Expects SCRAPERAPI_API_KEYS as comma-separated list of keys.
 */
export function createScraperApiKeyPool(): ScraperApiKeyPool {
  const keysEnv = process.env.SCRAPERAPI_API_KEYS;
  
  if (!keysEnv) {
    throw new Error("SCRAPERAPI_API_KEYS environment variable is not set");
  }

  const keys = keysEnv
    .split(",")
    .map(k => k.trim())
    .filter(k => k.length > 0);

  if (keys.length === 0) {
    throw new Error("SCRAPERAPI_API_KEYS contains no valid keys");
  }

  return createScraperApiKeyPoolFromKeys(keys);
}

/**
 * Create a ScraperAPI key pool from an array of keys.
 * Useful for testing.
 */
export function createScraperApiKeyPoolFromKeys(keys: string[]): ScraperApiKeyPool {
  if (keys.length === 0) {
    throw new Error("Cannot create key pool: no keys provided");
  }

  const keyStates: KeyState[] = keys.map(key => ({
    key,
    exhaustedMonth: null
  }));

  let currentIndex = 0;

  return {
    getNextKey(): string | null {
      const currentMonth = getCurrentMonth();
      
      // Reset exhausted flags if we're in a new month
      for (const state of keyStates) {
        if (state.exhaustedMonth && state.exhaustedMonth < currentMonth) {
          state.exhaustedMonth = null;
          console.log(`[ScraperAPI Key Pool] Key ${maskKey(state.key)} quota reset for new month`);
        }
      }

      // Find next available key
      const startIndex = currentIndex;
      
      do {
        const state = keyStates[currentIndex];
        
        if (!state.exhaustedMonth) {
          // Found an available key
          const key = state.key;
          currentIndex = (currentIndex + 1) % keyStates.length;
          return key;
        }

        currentIndex = (currentIndex + 1) % keyStates.length;
      } while (currentIndex !== startIndex);

      // All keys exhausted
      console.error("[ScraperAPI Key Pool] All API keys have exhausted their monthly quota");
      return null;
    },

    markKeyExhausted(key: string): void {
      const state = keyStates.find(s => s.key === key);
      
      if (!state) {
        console.warn(`[ScraperAPI Key Pool] Attempted to mark unknown key as exhausted: ${maskKey(key)}`);
        return;
      }

      const currentMonth = getCurrentMonth();
      
      if (state.exhaustedMonth === currentMonth) {
        // Already marked as exhausted this month
        return;
      }

      state.exhaustedMonth = currentMonth;
      console.log(`[ScraperAPI Key Pool] Marked key ${maskKey(key)} as exhausted for month ${currentMonth}`);

      const stats = this.getStats();
      console.log(`[ScraperAPI Key Pool] Status: ${stats.availableKeys}/${stats.totalKeys} keys available`);
    },

    getStats() {
      const currentMonth = getCurrentMonth();
      const exhaustedCount = keyStates.filter(s => s.exhaustedMonth === currentMonth).length;
      
      return {
        totalKeys: keyStates.length,
        availableKeys: keyStates.length - exhaustedCount,
        exhaustedKeys: exhaustedCount
      };
    }
  };
}

/**
 * Get current month in YYYY-MM format.
 */
function getCurrentMonth(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Mask an API key for safe logging.
 * Shows first 4 and last 4 characters.
 */
function maskKey(key: string): string {
  if (key.length <= 8) {
    return "****";
  }
  
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
