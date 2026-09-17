import { DEFAULT_HOST_URL } from './defaults.js';

/**
 * Side Panel persistence rules (spec v2.1 §19):
 *  - host URL: chrome.storage.local (survives restarts)
 *  - session token: chrome.storage.session (ephemeral, never synced, never in localStorage)
 *  - API keys: never stored here. They live in the Local Host credential store.
 */

const HOST_URL_KEY = 'desaignsync.hostUrl';
const TOKEN_KEY = 'desaignsync.sessionToken';

export const getHostUrl = async (): Promise<string> => {
  const stored = await chrome.storage.local.get(HOST_URL_KEY);
  const value = stored[HOST_URL_KEY];
  return typeof value === 'string' && value !== '' ? value : DEFAULT_HOST_URL;
};

export const setHostUrl = async (url: string): Promise<void> => {
  await chrome.storage.local.set({ [HOST_URL_KEY]: url.replace(/\/$/, '') });
};

export const getSessionToken = async (): Promise<string | undefined> => {
  const stored = await chrome.storage.session.get(TOKEN_KEY);
  const value = stored[TOKEN_KEY];
  return typeof value === 'string' && value !== '' ? value : undefined;
};

export const setSessionToken = async (token: string | undefined): Promise<void> => {
  if (token === undefined) {
    await chrome.storage.session.remove(TOKEN_KEY);
    return;
  }
  await chrome.storage.session.set({ [TOKEN_KEY]: token });
};