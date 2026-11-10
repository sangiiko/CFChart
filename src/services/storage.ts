import type browser from 'webextension-polyfill';
import type { Preferences } from '../types/app';
import type { CFUser, CFRatingChange, CFSubmission, PredictionParams } from '../types/codeforces';

export interface StorageData {
  preferences?: Preferences;
  cf_handle?: string;
  cf_user?: CFUser | null;
  cf_ratings?: CFRatingChange[];
  cf_submissions?: CFSubmission[];
  cf_cached_time?: number;
  cf_daily_target?: number;
  cf_prediction_params?: PredictionParams;
  cf_last_badge_text?: string;
}

export type ExtensionApi = typeof browser;

/** Access native Promise-based APIs without evaluating a polyfill in a website. */
export function getExtensionApi(): ExtensionApi | undefined {
  const globals = globalThis as typeof globalThis & { browser?: ExtensionApi; chrome?: ExtensionApi };
  const api = globals.browser ?? globals.chrome;
  return api?.runtime?.id ? api : undefined;
}

function requireStorage() {
  const storage = getExtensionApi()?.storage?.local;
  if (!storage) throw new Error('CFChart extension storage is unavailable. Load the built add-on in Firefox.');
  return storage;
}

/** Extension data never falls back to Codeforces' own localStorage. */
export const storageService = {
  async get<K extends keyof StorageData>(key: K): Promise<StorageData[K] | undefined> {
    return (await requireStorage().get(key))[key] as StorageData[K] | undefined;
  },
  async set<K extends keyof StorageData>(key: K, value: StorageData[K]): Promise<void> {
    await requireStorage().set({ [key]: value });
  },
  async remove(key: keyof StorageData): Promise<void> {
    await requireStorage().remove(key);
  },
  async getValue<T>(key: string): Promise<T | undefined> {
    return (await requireStorage().get(key))[key] as T | undefined;
  },
  async setValue<T>(key: string, value: T): Promise<void> {
    await requireStorage().set({ [key]: value });
  },
};
