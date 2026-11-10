import type { ExtensionRequest, ExtensionResponse, Preferences, PracticeSnapshot, ProfileSnapshot, RequestOptions } from '../types/app';
import { getExtensionApi } from './storage';

export class ExtensionClientError extends Error {
  constructor(message: string, public readonly code = 'extension_unavailable') {
    super(message);
    this.name = 'ExtensionClientError';
  }
}

async function request<T>(message: ExtensionRequest): Promise<T> {
  const api = getExtensionApi();
  if (!api) throw new ExtensionClientError('Load CFChart as a Firefox add-on to connect to Codeforces.');
  let response: ExtensionResponse<T>;
  try {
    response = await api.runtime.sendMessage(message) as ExtensionResponse<T>;
  } catch {
    throw new ExtensionClientError('CFChart could not reach its background process. Reload the add-on and this page.');
  }
  if (!response) throw new ExtensionClientError('CFChart did not receive a response. Reload the add-on and this page.');
  if (!response.ok) throw new ExtensionClientError(response.error, response.code ?? 'request_failed');
  return response.data;
}

export const getPreferences = () => request<Preferences>({ type: 'CFCHART_REQUEST', action: 'getPreferences' });
export const updatePreferences = (preferences: Partial<Preferences>) => request<Preferences>({ type: 'CFCHART_REQUEST', action: 'updatePreferences', preferences });
export const detectViewer = (handle: string) => request<Preferences>({ type: 'CFCHART_REQUEST', action: 'detectViewer', handle });
export const getProfile = (handle: string, options?: RequestOptions) => request<ProfileSnapshot>({ type: 'CFCHART_REQUEST', action: 'getProfile', handle, options });
export const getPractice = (handle: string, options?: RequestOptions) => request<PracticeSnapshot>({ type: 'CFCHART_REQUEST', action: 'getPractice', handle, options });

export function subscribeToChanges(callback: () => void): () => void {
  const api = getExtensionApi();
  if (!api?.storage?.onChanged) return () => {};
  const listener = (changes: Record<string, unknown>, areaName: string) => {
    if (areaName === 'local' && Object.keys(changes).some(key => key === 'preferences' || key.startsWith('cfchart:'))) callback();
  };
  api.storage.onChanged.addListener(listener);
  return () => api.storage.onChanged.removeListener(listener);
}
