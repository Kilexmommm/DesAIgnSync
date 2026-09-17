import type { McpServerConfig } from '@desaignsync/shared-types';

/**
 * Built-in MCP presets (spec v2.1 §7.1 / §7.2).
 * Chrome DevTools MCP is the evidence source; Storybook is only one possible Design System MCP.
 * Presets are plain configuration: no vendor-specific code lives here.
 */
export const CHROME_DEVTOOLS_PRESET_ID = 'chrome-devtools';
export const STORYBOOK_DS_PRESET_ID = 'storybook-ds';

export const createChromeDevToolsPreset = (
  overrides: Partial<McpServerConfig> = {}
): McpServerConfig => ({
  id: CHROME_DEVTOOLS_PRESET_ID,
  name: 'Chrome DevTools',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', 'chrome-devtools-mcp@latest', '--autoConnect'],
  role: 'inspection',
  enabled: true,
  autoStart: false,
  presetId: CHROME_DEVTOOLS_PRESET_ID,
  description:
    'Chrome DevTools MCP: accessibility snapshot, computed styles, controlled JS evaluation, geometry and screenshots.',
  ...overrides
});

export const createStorybookDesignSystemPreset = (
  url = 'http://localhost:6006/mcp',
  overrides: Partial<McpServerConfig> = {}
): McpServerConfig => ({
  id: STORYBOOK_DS_PRESET_ID,
  name: 'Design System Storybook',
  transport: 'streamable-http',
  url,
  role: 'design-system-reference',
  enabled: true,
  autoStart: false,
  presetId: STORYBOOK_DS_PRESET_ID,
  description:
    'Storybook MCP preset. Storybook MCP is documented as a preview feature, so it is consumed through the generic Design System MCP adapter.',
  ...overrides
});

export const getDefaultMcpPresets = (): McpServerConfig[] => [
  createChromeDevToolsPreset(),
  createStorybookDesignSystemPreset()
];