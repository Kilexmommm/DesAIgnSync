import { normalizeElementTarget } from '@desaignsync/core';
import type { ElementTarget } from '@desaignsync/shared-types';

import { pickElementInPage, type PickerPayload } from './pickerScript.js';

/**
 * Starts a pick session on the active tab (DS-012).
 *
 * The inspected page is only ever read: we request an optional host permission, inject the
 * self-contained picker, and let the user click. Nothing in the app is modified (see ADR-009).
 */

const PICKER_ORIGINS = ['http://*/*', 'https://*/*'];

export interface ElementPickOutcome {
  target?: ElementTarget;
  cancelled: boolean;
  error?: string;
}

export async function hasPickerPermission(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: PICKER_ORIGINS });
  } catch {
    return false;
  }
}

export async function requestPickerPermission(): Promise<boolean> {
  try {
    return await chrome.permissions.request({ origins: PICKER_ORIGINS });
  } catch {
    return false;
  }
}

export async function startElementPick(): Promise<ElementPickOutcome> {
  if (!(await hasPickerPermission()) && !(await requestPickerPermission())) {
    return {
      cancelled: false,
      error: 'Permission to inspect the active tab was not granted.'
    };
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { cancelled: false, error: 'No active tab to inspect.' };
  }
  if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
    return { cancelled: false, error: 'Chrome internal pages cannot be inspected.' };
  }

  try {
    const injections = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: pickElementInPage,
      args: [{ timeoutMs: 60_000 }]
    });
    const payload = injections[0]?.result as PickerPayload | null | undefined;
    if (!payload) return { cancelled: true };

    const validation = normalizeElementTarget({
      ...payload,
      tabId: tab.id,
      url: payload.url ?? tab.url
    });
    if (!validation.ok || !validation.target) {
      return { cancelled: false, error: validation.issues.join(' ') || 'Invalid selection payload.' };
    }
    return { cancelled: false, target: validation.target };
  } catch (error) {
    return {
      cancelled: false,
      error: error instanceof Error ? error.message : 'Element selection failed.'
    };
  }
}
