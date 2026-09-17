import {
  EVIDENCE_SCHEMA_VERSION,
  type Box,
  type ComputedStyleEvidence,
  type Dimensions,
  type PageElementEvidence,
  type Rectangle
} from '@desaignsync/shared-types';

import { normalizeClassNames } from './classNormalizer.js';

/**
 * Evidence normalization (DS-010, spec v2.1 §10.1 and AC-21).
 *
 * Turns loose Chrome DevTools MCP output into the versioned `PageElementEvidence` model:
 * observed facts stay separate from derived data, and anything not provided by the page stays
 * `undefined` instead of being invented (AC-15/AC-17 and the Core Prompt rules §14.1).
 */

export interface RawParentContext {
  tagName?: unknown;
  role?: unknown;
  classNames?: unknown;
  distance?: unknown;
}

export interface RawChildSummary {
  tagName?: unknown;
  role?: unknown;
  classNames?: unknown;
}

/** Loose shape accepted from the Chrome adapter. Everything is validated on the way in. */
export interface RawElementSource {
  pageId: number;
  uid?: unknown;
  url?: unknown;
  tagName?: unknown;
  role?: unknown;
  accessibleName?: unknown;
  textHint?: unknown;
  inputType?: unknown;
  attributes?: unknown;
  classNames?: unknown;
  ariaState?: unknown;
  parentContext?: RawParentContext;
  childSummary?: unknown;
  labelTexts?: unknown;
  computedStyles?: unknown;
  geometry?: unknown;
  viewport?: unknown;
  disabled?: unknown;
  readOnly?: unknown;
  required?: unknown;
  screenshotRef?: unknown;
  snapshotExcerpt?: unknown;
  source?: { inspectionMcpId?: unknown; toolName?: unknown };
}

export interface NormalizeEvidenceOptions {
  schemaVersion?: number;
  collectedAt?: string;
}

export interface EvidenceCoverage {
  presentFields: string[];
  missingFields: string[];
  /** 0..1 share of the fields matching is expected to use. */
  ratio: number;
}

const MAX_TEXT_LENGTH = 280;
const MAX_ATTRIBUTE_LENGTH = 200;

export const asNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed.slice(0, MAX_TEXT_LENGTH);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
};

const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

export const parseCssNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === '' || trimmed === 'normal' || trimmed === 'auto' || trimmed === 'none') {
    return undefined;
  }
  const pxMatch = /^(-?\d+(?:\.\d+)?)px$/.exec(trimmed);
  if (pxMatch?.[1] !== undefined) return Number.parseFloat(pxMatch[1]);
  // Unitless numbers are meaningful; rem/em/% are intentionally left unknown (no invention).
  return /^-?\d+(?:\.\d+)?$/.test(trimmed) ? Number.parseFloat(trimmed) : undefined;
};

const COLOR_PATTERN = /^(#([0-9a-f]{3,8})|rgba?\(|hsla?\(|[a-z]+$)/i;

export const asColor = (value: unknown): string | undefined => {
  const text = asNonEmptyString(value);
  return text !== undefined && COLOR_PATTERN.test(text) ? text : undefined;
};

export const parseBox = (value: unknown): Box | undefined => {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const top = parseCssNumber(record['top']);
    const right = parseCssNumber(record['right']);
    const bottom = parseCssNumber(record['bottom']);
    const left = parseCssNumber(record['left']);
    if ([top, right, bottom, left].every((entry) => entry !== undefined)) {
      return { top: top as number, right: right as number, bottom: bottom as number, left: left as number };
    }
    return undefined;
  }
  const text = asNonEmptyString(value);
  if (text === undefined) return undefined;
  const parts = text.split(/\s+/).map((part) => parseCssNumber(part));
  if (parts.some((part) => part === undefined)) return undefined;
  const [a, b, c, d] = parts as number[];
  if (a === undefined) return undefined;
  if (b === undefined) return { top: a, right: a, bottom: a, left: a };
  if (c === undefined) return { top: a, right: b, bottom: a, left: b };
  if (d === undefined) return { top: a, right: b, bottom: c, left: b };
  return { top: a, right: b, bottom: c, left: d };
};

const asStringRecord = (value: unknown): Record<string, string> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => [key, asNonEmptyString(entry)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
    .map(([key, entry]) => [key, entry.slice(0, MAX_ATTRIBUTE_LENGTH)] as const);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
};

const asStringList = (value: unknown, limit = 40): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((entry) => asNonEmptyString(entry))
    .filter((entry): entry is string => entry !== undefined)
    .slice(0, limit);
  return items.length === 0 ? undefined : items;
};

const asRectangle = (value: unknown): Rectangle | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const x = parseCssNumber(record['x']);
  const y = parseCssNumber(record['y']);
  const width = parseCssNumber(record['width']);
  const height = parseCssNumber(record['height']);
  if ([x, y, width, height].every((entry) => entry !== undefined)) {
    return { x: x as number, y: y as number, width: width as number, height: height as number };
  }
  return undefined;
};

const asDimensions = (value: unknown): Dimensions | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const width = parseCssNumber(record['width']);
  const height = parseCssNumber(record['height']);
  return width !== undefined && height !== undefined ? { width, height } : undefined;
};

const mapComputedStyle = (value: unknown): ComputedStyleEvidence | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const style: ComputedStyleEvidence = {};
  const assignNumber = (key: keyof ComputedStyleEvidence, rawKey: string): void => {
    const parsed = parseCssNumber(raw[rawKey]);
    if (parsed !== undefined) (style[key] as number) = parsed;
  };
  const assignText = (key: keyof ComputedStyleEvidence, rawKey: string): void => {
    const parsed = asNonEmptyString(raw[rawKey]);
    if (parsed !== undefined) (style[key] as string) = parsed;
  };
  const assignColor = (key: keyof ComputedStyleEvidence, rawKey: string): void => {
    const parsed = asColor(raw[rawKey]);
    if (parsed !== undefined) (style[key] as string) = parsed;
  };

  assignColor('color', 'color');
  assignColor('backgroundColor', 'backgroundColor');
  assignColor('borderColor', 'borderColor');
  assignText('fontFamily', 'fontFamily');
  assignNumber('fontSize', 'fontSize');
  assignNumber('fontWeight', 'fontWeight');
  assignNumber('lineHeight', 'lineHeight');
  assignNumber('letterSpacing', 'letterSpacing');
  assignNumber('gap', 'gap');
  assignNumber('width', 'width');
  assignNumber('height', 'height');
  assignNumber('minWidth', 'minWidth');
  assignNumber('minHeight', 'minHeight');
  assignNumber('maxWidth', 'maxWidth');
  assignNumber('maxHeight', 'maxHeight');
  assignNumber('borderRadius', 'borderRadius');
  assignNumber('borderWidth', 'borderWidth');
  assignNumber('opacity', 'opacity');
  assignText('borderStyle', 'borderStyle');
  assignText('boxShadow', 'boxShadow');
  assignText('display', 'display');
  assignText('position', 'position');

  const padding = parseBox(raw['padding']);
  if (padding) style.padding = padding;
  const margin = parseBox(raw['margin']);
  if (margin) style.margin = margin;

  return Object.keys(style).length === 0 ? undefined : style;
};

const mapParentContext = (value: RawParentContext | undefined): PageElementEvidence['parentContext'] => {
  if (!value) return undefined;
  const tagName = asNonEmptyString(value.tagName);
  const role = asNonEmptyString(value.role);
  const classTokens = asStringList(value.classNames, 30);
  const normalizedTokens = classTokens ? normalizeClassNames(classTokens).semanticTokens : undefined;
  const context: NonNullable<PageElementEvidence['parentContext']> = {};
  if (tagName !== undefined) context.tagName = tagName;
  if (role !== undefined) context.role = role;
  if (normalizedTokens !== undefined) context.classTokens = normalizedTokens;
  const distance = parseCssNumber(value.distance);
  if (distance !== undefined) context.distance = distance;
  return Object.keys(context).length === 0 ? undefined : context;
};

const mapChildSummary = (value: unknown): PageElementEvidence['childSummary'] => {
  if (!Array.isArray(value)) return undefined;
  const children = value
    .filter((entry): entry is RawChildSummary => typeof entry === 'object' && entry !== null)
    .map((entry) => {
      const child: NonNullable<PageElementEvidence['childSummary']>[number] = {};
      const tagName = asNonEmptyString(entry.tagName);
      const role = asNonEmptyString(entry.role);
      const classTokens = asStringList(entry.classNames, 10);
      if (tagName !== undefined) child.tagName = tagName;
      if (role !== undefined) child.role = role;
      if (classTokens !== undefined) child.classTokens = normalizeClassNames(classTokens).semanticTokens;
      return child;
    })
    .slice(0, 12);
  return children.length === 0 ? undefined : children;
};

/** Normalizes a raw page descriptor into observable, auditable evidence. */
export function normalizeElementEvidence(
  raw: RawElementSource,
  options: NormalizeEvidenceOptions = {}
): PageElementEvidence {
  const classNames = asStringList(raw.classNames, 60);
  const normalization = classNames ? normalizeClassNames(classNames) : undefined;

  const evidence: PageElementEvidence = {
    schemaVersion: options.schemaVersion ?? EVIDENCE_SCHEMA_VERSION,
    kind: 'observed',
    pageId: raw.pageId
  };

  const uid = asNonEmptyString(raw.uid);
  if (uid !== undefined) evidence.uid = uid;
  const url = asNonEmptyString(raw.url);
  if (url !== undefined) evidence.url = url;
  const tagName = asNonEmptyString(raw.tagName)?.toLowerCase();
  if (tagName !== undefined) evidence.tagName = tagName;
  const role = asNonEmptyString(raw.role);
  if (role !== undefined) evidence.role = role;
  const accessibleName = asNonEmptyString(raw.accessibleName);
  if (accessibleName !== undefined) evidence.accessibleName = accessibleName;
  const textHint = asNonEmptyString(raw.textHint);
  if (textHint !== undefined) evidence.textHint = textHint;
  const inputType = asNonEmptyString(raw.inputType)?.toLowerCase();
  if (inputType !== undefined) evidence.inputType = inputType;

  const attributes = asStringRecord(raw.attributes);
  if (attributes !== undefined) evidence.attributes = attributes;
  if (classNames !== undefined) evidence.classNames = classNames;
  if (normalization !== undefined && normalization.semanticTokens.length > 0) {
    evidence.normalizedClassTokens = normalization.semanticTokens;
  }

  const ariaState = asStringRecord(raw.ariaState);
  if (ariaState !== undefined) evidence.ariaState = ariaState;
  const labelRefs = asStringList(raw.labelTexts, 5);
  if (labelRefs !== undefined) evidence.labelRefs = labelRefs;

  const parentContext = mapParentContext(raw.parentContext);
  if (parentContext !== undefined) evidence.parentContext = parentContext;
  const childSummary = mapChildSummary(raw.childSummary);
  if (childSummary !== undefined) evidence.childSummary = childSummary;

  const computedStyle = mapComputedStyle(raw.computedStyles);
  if (computedStyle !== undefined) evidence.computedStyle = computedStyle;
  const geometry = asRectangle(raw.geometry);
  if (geometry !== undefined) evidence.geometry = geometry;
  const viewport = asDimensions(raw.viewport);
  if (viewport !== undefined) evidence.viewport = viewport;

  const disabled = asBoolean(raw.disabled);
  if (disabled !== undefined) evidence.disabled = disabled;
  const readOnly = asBoolean(raw.readOnly);
  if (readOnly !== undefined) evidence.readOnly = readOnly;
  const required = asBoolean(raw.required);
  if (required !== undefined) evidence.required = required;

  const screenshotRef = asNonEmptyString(raw.screenshotRef);
  if (screenshotRef !== undefined) evidence.screenshotRef = screenshotRef;
  const snapshotExcerpt = asNonEmptyString(raw.snapshotExcerpt);
  if (snapshotExcerpt !== undefined) evidence.snapshotExcerpt = snapshotExcerpt;
  evidence.collectedAt = options.collectedAt ?? new Date().toISOString();

  const observationMcp = asNonEmptyString(raw.source?.inspectionMcpId);
  const observationTool = asNonEmptyString(raw.source?.toolName);
  if (observationMcp !== undefined || observationTool !== undefined) {
    evidence.source = {};
    if (observationMcp !== undefined) evidence.source.inspectionMcpId = observationMcp;
    if (observationTool !== undefined) evidence.source.toolName = observationTool;
  }

  const hasObservableFact =
    evidence.uid !== undefined ||
    evidence.tagName !== undefined ||
    evidence.role !== undefined ||
    evidence.accessibleName !== undefined ||
    evidence.classNames !== undefined ||
    evidence.computedStyle !== undefined ||
    evidence.geometry !== undefined;
  if (!hasObservableFact) evidence.kind = 'unknown';

  return evidence;
}

const EXPECTED_MATCH_FIELDS = [
  'tagName',
  'role',
  'accessibleName',
  'inputType',
  'attributes',
  'classNames',
  'computedStyle',
  'geometry',
  'parentContext',
  'childSummary',
  'screenshotRef'
] as const;

/** How much of the evidence matching needs is actually present (used for REVIEW decisions). */
export function evidenceCoverage(evidence: PageElementEvidence): EvidenceCoverage {
  const presentFields: string[] = [];
  const missingFields: string[] = [];
  for (const field of EXPECTED_MATCH_FIELDS) {
    if (evidence[field] === undefined) missingFields.push(field);
    else presentFields.push(field);
  }
  return {
    presentFields,
    missingFields,
    ratio: presentFields.length / EXPECTED_MATCH_FIELDS.length
  };
}

/** Compact, secret-free description for logs and LLM payloads (no attributes are included). */
export function summarizeEvidence(evidence: PageElementEvidence): Record<string, unknown> {
  const styleKeys = evidence.computedStyle ? Object.keys(evidence.computedStyle) : [];
  return {
    schemaVersion: evidence.schemaVersion,
    kind: evidence.kind,
    pageId: evidence.pageId,
    ...(evidence.uid !== undefined ? { uid: evidence.uid } : {}),
    ...(evidence.tagName !== undefined ? { tag: evidence.tagName } : {}),
    ...(evidence.role !== undefined ? { role: evidence.role } : {}),
    ...(evidence.accessibleName !== undefined ? { name: evidence.accessibleName } : {}),
    ...(evidence.inputType !== undefined ? { inputType: evidence.inputType } : {}),
    ...(evidence.classNames !== undefined ? { classes: evidence.classNames } : {}),
    ...(evidence.normalizedClassTokens !== undefined
      ? { classTokens: evidence.normalizedClassTokens }
      : {}),
    ...(styleKeys.length > 0 ? { styleKeys } : {}),
    hasGeometry: evidence.geometry !== undefined,
    hasScreenshot: evidence.screenshotRef !== undefined
  };
}

