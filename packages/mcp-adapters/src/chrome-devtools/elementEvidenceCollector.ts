import type { JsonObject } from '@desaignsync/shared-types';

/**
 * Read-only element evidence collector (DS-005 -> DS-010 bridge, spec v2.1 §10).
 *
 * The expression is executed BY the Chrome DevTools MCP server (`evaluate_script`), never by
 * the extension, and it only reads: `querySelector`, `getAttribute`, `classList`, `labels`,
 * `children`, `getComputedStyle` and `getBoundingClientRect`. It never writes to the page.
 *
 * Because the expression is serialized into the page, it must be self-contained: it only uses
 * `document` and `window`. `value` and any non-allowlisted attribute are deliberately skipped
 * so form contents and opaque data never reach the host (spec §19/§22).
 */
export interface CollectedElementDescriptor {
  tagName?: string;
  role?: string;
  accessibleName?: string;
  textHint?: string;
  inputType?: string;
  attributes?: Record<string, string>;
  classNames?: string[];
  ariaState?: Record<string, string>;
  labelTexts?: string[];
  childSummary?: Array<{ tagName?: string; role?: string; classNames?: string[] }>;
  computedStyles?: Record<string, string | number>;
  geometry?: { x: number; y: number; width: number; height: number };
  viewport?: { width: number; height: number };
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
}

/** Marker the read-only snippets carry so fixtures and logs can recognize them. */
export const COLLECT_EVIDENCE_MARKER = 'desaignsync:collect-element-evidence';

export const buildElementEvidenceExpression = (selector: string): string => {
  const selectorLiteral = JSON.stringify(selector);
  return `(() => {
  /* ${COLLECT_EVIDENCE_MARKER} */
  const selector = ${selectorLiteral};
  const element = document.querySelector(selector);
  if (!element) return null;
  const win = window;
  const style = win.getComputedStyle ? win.getComputedStyle(element) : undefined;
  const trim = (value) => (typeof value === 'string' ? value.trim() : '');
  const limit = (value, max) => { const text = trim(value); return text.length > max ? text.slice(0, max) : text; };
  const attr = (name) => { try { return element.getAttribute(name); } catch { return null; } };
  const CSS_KEYS = ['color', 'backgroundColor', 'borderColor', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'gap', 'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'borderRadius', 'borderWidth', 'borderStyle', 'boxShadow', 'opacity', 'display', 'position'];
  const ALLOWED_ATTRIBUTES = ['type', 'name', 'placeholder', 'role', 'title', 'alt', 'href', 'disabled', 'required', 'readonly', 'autocomplete', 'aria-label', 'aria-labelledby', 'aria-expanded', 'aria-selected', 'aria-checked', 'aria-disabled', 'aria-required', 'aria-invalid', 'aria-haspopup', 'aria-controls'];
  const descriptor = {};
  const computedStyles = {};
  if (style) {
    for (const key of CSS_KEYS) { const value = style[key]; if (typeof value === 'string' && value !== '') computedStyles[key] = value; }
    const padding = [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft];
    const margin = [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft];
    if (padding.every((value) => typeof value === 'string')) computedStyles.padding = padding.join(' ');
    if (margin.every((value) => typeof value === 'string')) computedStyles.margin = margin.join(' ');
  }
  const attributes = {};
  const ariaState = {};
  for (const name of ALLOWED_ATTRIBUTES) {
    const value = attr(name);
    if (value === null || value === '') continue;
    attributes[name] = limit(value, 120);
    if (name.indexOf('aria-') === 0) ariaState[name] = limit(value, 60);
  }
  const classNames = element.classList ? Array.from(element.classList).map(String).slice(0, 60) : [];
  const labels = element.labels ? Array.from(element.labels).map((label) => limit(label && label.textContent, 120)).filter((text) => text !== '') : undefined;
  const children = element.children ? Array.from(element.children).slice(0, 8).map((child) => ({
    tagName: child && child.tagName ? String(child.tagName).toLowerCase() : undefined,
    role: child && child.getAttribute ? (child.getAttribute('role') || undefined) : undefined,
    classNames: child && child.classList ? Array.from(child.classList).map(String).slice(0, 12) : []
  })) : undefined;
  const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : undefined;
  const tagName = element.tagName ? String(element.tagName).toLowerCase() : undefined;
  const textHint = limit(element.textContent, 160);
  const accessibleName = limit((attr('aria-label') || '') || (labels && labels.length > 0 ? labels.join(' ') : '') || (attr('placeholder') || '') || element.textContent, 200);
  if (tagName) descriptor.tagName = tagName;
  const role = attr('role');
  if (role) descriptor.role = limit(role, 40);
  if (accessibleName !== '') descriptor.accessibleName = accessibleName;
  if (textHint !== '') descriptor.textHint = textHint;
  const inputType = attr('type');
  if (inputType) descriptor.inputType = limit(inputType, 40);
  if (Object.keys(attributes).length > 0) descriptor.attributes = attributes;
  if (classNames.length > 0) descriptor.classNames = classNames;
  if (Object.keys(ariaState).length > 0) descriptor.ariaState = ariaState;
  if (labels !== undefined) descriptor.labelTexts = labels;
  if (children !== undefined) descriptor.childSummary = children;
  if (Object.keys(computedStyles).length > 0) descriptor.computedStyles = computedStyles;
  if (rect) descriptor.geometry = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  if (win.innerWidth !== undefined && win.innerHeight !== undefined) descriptor.viewport = { width: win.innerWidth, height: win.innerHeight };
  if (typeof element.disabled === 'boolean') descriptor.disabled = element.disabled;
  if (typeof element.readOnly === 'boolean') descriptor.readOnly = element.readOnly;
  if (typeof element.required === 'boolean') descriptor.required = element.required;
  return descriptor;
})()`;
};

/** Reads the descriptor out of an `evaluate_script` result (structured first, then JSON text). */
export const readCollectedDescriptor = (evaluation: {
  structured?: unknown;
  text: string;
}): CollectedElementDescriptor | undefined => {
  const structured = evaluation.structured;
  if (isRecord(structured)) {
    const result = structured['result'];
    if (isRecord(result)) return result as CollectedElementDescriptor;
    if (typeof result === 'string') {
      const parsed = tryParseRecord(result);
      if (parsed) return parsed as CollectedElementDescriptor;
    }
    if (typeof structured['tagName'] === 'string') return structured as CollectedElementDescriptor;
  }
  const parsed = tryParseRecord(evaluation.text);
  return parsed ? (parsed as CollectedElementDescriptor) : undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const tryParseRecord = (value: string): Record<string, unknown> | undefined => {
  const text = value.trim();
  if (!text.startsWith('{')) return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export type CollectedDescriptorJson = JsonObject;
