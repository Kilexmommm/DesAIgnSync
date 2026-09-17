import type { DsLogicalOperation } from '@desaignsync/shared-types';

import type { LogicalAliasTable } from '../tool-discovery.js';

/**
 * Default alias table mapping the five logical DS operations (spec v2.1 §11.1)
 * onto real-world MCP tool names. Canonical logical names first, then the
 * vendor-shaped variants seen across generic Design System MCPs.
 * The Storybook preset (DS-007) layers its own names on top of this table.
 */
export const DS_TOOL_ALIASES: LogicalAliasTable<DsLogicalOperation> = {
  list_components: [
    'list_components',
    'list-components',
    'components_list',
    'get_components',
    'fetch_components',
    'inventory',
    'list_inventory',
    'get_inventory',
    'discover_components',
    'all_components',
    'components'
  ],
  get_component: [
    'get_component',
    'get-component',
    'component_details',
    'component-details',
    'get_component_details',
    'fetch_component',
    'describe_component',
    'component',
    'details',
    'storyId',
    'story_id'
  ],
  search_components: [
    'search_components',
    'search-components',
    'search',
    'search_inventory',
    'find_components',
    'find-component',
    'find_component',
    'query_components',
    'lookup_component',
    'match_component',
    'query'
  ],
  get_variant_reference: [
    'get_variant_reference',
    'get-variant-reference',
    'variant_reference',
    'get_variant',
    'fetch_variant',
    'variant_details',
    'variant-details',
    'get_story_reference',
    'get_story',
    'story_reference',
    'variant'
  ],
  get_usage_guidelines: [
    'get_usage_guidelines',
    'usage_guidelines',
    'get_guidelines',
    'get_docs',
    'component_docs',
    'usage_docs',
    'usage-docs',
    'get_documentation',
    'docs',
    'guidelines',
    'documentation'
  ]
};
