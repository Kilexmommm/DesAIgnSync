import type { DsLogicalOperation } from '@desaignsync/shared-types';

import type { McpToolGateway } from '../mcp-tool-gateway.js';
import {
  DesignSystemMCPAdapter,
  type DesignSystemAdapterOptions
} from '../design-system/design-system-mcp-adapter.js';

export { DesignSystemMCPAdapter };
export type { DesignSystemAdapterOptions };

export const STORYBOOK_MCP_PRESET_ID = 'storybook-ds';

/**
 * Storybook-shaped tool names layered over the generic DS aliases (DS-007).
 * Kept as pure mapping data: the product core still consumes only the five
 * logical operations from spec §11.1, so a Storybook preview-API rename only
 * touches this table. Canonical logical names keep priority; these extras
 * simply widen discovery.
 */
export const STORYBOOK_EXTRA_ALIASES: Record<DsLogicalOperation, readonly string[]> = {
  list_components: [
    'list_stories',
    'get_stories',
    'stories',
    'story_index',
    'storyindex',
    'get_index',
    'get_storybook_index',
    'index'
  ],
  get_component: [
    'get_story',
    'fetch_story',
    'story',
    'get_component_metadata',
    'get_story_metadata',
    'story_metadata',
    'component_metadata'
  ],
  search_components: ['search_stories', 'search_storybook', 'find_stories', 'find_story'],
  get_variant_reference: [
    'get_story_reference',
    'story_reference',
    'get_story_context',
    'story_context',
    'get_variant',
    'fetch_variant'
  ],
  get_usage_guidelines: [
    'get_story_docs',
    'story_docs',
    'get_docs',
    'component_docs',
    'storybook_docs'
  ]
};

/**
 * Thin Storybook preset over the generic adapter (DS-007): same behavior and
 * normalized models, only a wider discovery table. Explicit per-deployment
 * overrides still win over every alias.
 */
export class StorybookMCPAdapter extends DesignSystemMCPAdapter {
  constructor(gateway: McpToolGateway, options: DesignSystemAdapterOptions = {}) {
    super(gateway, {
      ...options,
      extraAliases: mergeStorybookExtras(options.extraAliases ?? {})
    });
  }
}

export const createStorybookAdapter = (
  gateway: McpToolGateway,
  options: DesignSystemAdapterOptions = {}
): StorybookMCPAdapter => new StorybookMCPAdapter(gateway, options);

const mergeStorybookExtras = (
  caller: Partial<Record<DsLogicalOperation, readonly string[]>>
): Partial<Record<DsLogicalOperation, readonly string[]>> => {
  const merged: Partial<Record<DsLogicalOperation, readonly string[]>> = {};
  const operations = Object.keys(STORYBOOK_EXTRA_ALIASES) as DsLogicalOperation[];
  for (const operation of operations) {
    merged[operation] = [...STORYBOOK_EXTRA_ALIASES[operation], ...(caller[operation] ?? [])];
  }
  return merged;
};
