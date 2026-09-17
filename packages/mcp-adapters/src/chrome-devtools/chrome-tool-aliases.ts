import type { LogicalAliasTable } from '../tool-discovery.js';

/**
 * Logical inspection operations over Chrome DevTools MCP (DS-005, spec v2.1 §10).
 * The adapter resolves each one onto whatever tool names the connected server
 * actually exposes; aliases are ordered canonical-first.
 */
export const CHROME_LOGICAL_OPERATIONS = [
  'list_pages',
  'select_page',
  'take_snapshot',
  'get_css_styles',
  'evaluate_script',
  'take_screenshot'
] as const;

export type ChromeLogicalOperation = (typeof CHROME_LOGICAL_OPERATIONS)[number];

export const CHROME_TOOL_ALIASES: LogicalAliasTable<ChromeLogicalOperation> = {
  list_pages: [
    'list_pages',
    'list-pages',
    'pages_list',
    'list_tabs',
    'list-tabs',
    'tabs_list',
    'get_pages',
    'get_tabs',
    'pages',
    'tabs',
    'browser_list_pages',
    'chrome_list_pages',
    'devtools_list_pages',
    'list_targets'
  ],
  select_page: [
    'select_page',
    'select-page',
    'select_tab',
    'select-tab',
    'activate_page',
    'activate_tab',
    'activate-tab',
    'switch_page',
    'switch_tab',
    'set_page',
    'set_active_page',
    'focus_page',
    'focus_tab',
    'chrome_select_page'
  ],
  take_snapshot: [
    'take_snapshot',
    'take-snapshot',
    'snapshot',
    'get_snapshot',
    'capture_snapshot',
    'page_snapshot',
    'accessibility_snapshot',
    'a11y_snapshot',
    'get_accessibility_tree',
    'ax_tree'
  ],
  get_css_styles: [
    'get_css_styles',
    'get-css-styles',
    'css_styles',
    'computed_styles',
    'computed-styles',
    'get_computed_styles',
    'get_computed_style',
    'get_styles',
    'query_css',
    'element_styles'
  ],
  evaluate_script: [
    'evaluate_script',
    'evaluate-script',
    'evaluate',
    'eval_script',
    'run_script',
    'run-script',
    'run_js',
    'execute_script',
    'eval',
    'js_evaluate',
    'runtime_evaluate',
    'evaluate_javascript',
    'run_javascript'
  ],
  take_screenshot: [
    'take_screenshot',
    'take-screenshot',
    'screenshot',
    'capture_screenshot',
    'capture-screenshot',
    'page_screenshot',
    'element_screenshot',
    'get_screenshot'
  ]
};
