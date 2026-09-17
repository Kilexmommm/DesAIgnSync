/**
 * MV3 background service worker.
 *
 * Responsibility in Wave 1 (DS-002): Side Panel lifecycle only.
 * It does NOT execute processes, does not call MCP servers and does not hold secrets:
 * all integration work happens in the Local MCP Host (spec v2.1 §6.2).
 */

const supportsSidePanel = (): boolean =>
  typeof chrome !== 'undefined' && typeof chrome.sidePanel !== 'undefined';

chrome.runtime.onInstalled.addListener(() => {
  if (!supportsSidePanel()) return;
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {
      // Older Chrome builds: the toolbar click handler below still opens the panel.
    });
});

chrome.action?.onClicked.addListener((tab) => {
  if (!supportsSidePanel() || tab.windowId === undefined) return;
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {
    // The Side Panel can also be opened manually from the Chrome UI.
  });
});

export {};