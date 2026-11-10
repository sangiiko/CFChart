import browser from 'webextension-polyfill';

export interface StorageData {
  cf_handle?: string;
  cf_user?: any;
  cf_ratings?: any[];
  cf_submissions?: any[];
  cf_cached_time?: number;
  cf_daily_target?: number;
  cf_prediction_params?: any;
  cf_last_badge_text?: string;
}

const isExtensionEnvironment = (): boolean => {
  try {
    return typeof browser !== 'undefined' && !!browser.storage && !!browser.storage.local;
  } catch {
    return false;
  }
};

export const storageService = {
  async get<K extends keyof StorageData>(key: K): Promise<StorageData[K] | undefined> {
    if (isExtensionEnvironment()) {
      try {
        const result = await browser.storage.local.get(key);
        return result[key] as StorageData[K] | undefined;
      } catch (err) {
        console.warn('browser.storage.local.get failed, falling back to localStorage', err);
      }
    }

    if (typeof window !== 'undefined' && window.localStorage) {
      const item = window.localStorage.getItem(`cfchart_${key}`);
      if (item) {
        try {
          return JSON.parse(item) as StorageData[K];
        } catch {
          return item as unknown as StorageData[K];
        }
      }
    }
    return undefined;
  },

  async set<K extends keyof StorageData>(key: K, value: StorageData[K]): Promise<void> {
    if (isExtensionEnvironment()) {
      try {
        await browser.storage.local.set({ [key]: value });
        return;
      } catch (err) {
        console.warn('browser.storage.local.set failed, falling back to localStorage', err);
      }
    }

    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(`cfchart_${key}`, JSON.stringify(value));
    }
  },

  async remove(key: keyof StorageData): Promise<void> {
    if (isExtensionEnvironment()) {
      try {
        await browser.storage.local.remove(key);
        return;
      } catch (err) {
        console.warn('browser.storage.local.remove failed, falling back to localStorage', err);
      }
    }

    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(`cfchart_${key}`);
    }
  }
};
