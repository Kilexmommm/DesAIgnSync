import {
  EVIDENCE_SCHEMA_VERSION,
  type Dimensions,
  type ElementTarget,
  type Rectangle
} from '@desaignsync/shared-types';

import type { RawElementSource } from './normalizeElementEvidence.js';

/**
 * Element target validation (DS-012).
 *
 * The picker runs inside the inspected page, so everything it returns is untrusted input:
 * it is validated here before it reaches evidence collection, matching or the LLM.
 */

export interface ElementTargetValidation {
  ok: boolean;
  target?: ElementTarget;
  issues: string[];
}

const MAX_SELECTOR_LENGTH = 400;
const MAX_TAG_LENGTH = 30;
const MAX_TEXT_LENGTH = 280;
const TAG_PATTERN = /^[a-z][a-z0-9-]*$/i;

const cleanText = (value: unknown, limit = MAX_TEXT_LENGTH): string | undefined => {
  if (typeof value !== 'string') return undefined;
  // Strip control characters that untrusted page content can smuggle into the report.
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned === '' ? undefined : cleaned.slice(0, limit);
};

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const parseRect = (value: unknown): Rectangle | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const x = asFiniteNumber(record['x']);
  const y = asFiniteNumber(record['y']);
  const width = asFiniteNumber(record['width']);
  const height = asFiniteNumber(record['height']);
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  if (width < 0 || height < 0) return undefined;
  return { x, y, width, height };
};

const parseDimensions = (value: unknown): Dimensions | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const width = asFiniteNumber(record['width']);
  const height = asFiniteNumber(record['height']);
  return width !== undefined && height !== undefined && width > 0 && height > 0
    ? { width, height }
    : undefined;
};

export function normalizeElementTarget(raw: unknown): ElementTargetValidation {
  const issues: string[] = [];
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, issues: ['Picker payload is not an object.'] };
  }
  const record = raw as Record<string, unknown>;

  const selector = cleanText(record['selector'], MAX_SELECTOR_LENGTH);
  if (selector === undefined) issues.push('Missing selector.');

  const rawTag = cleanText(record['tagName'], MAX_TAG_LENGTH);
  const tagName = rawTag !== undefined && TAG_PATTERN.test(rawTag) ? rawTag.toLowerCase() : undefined;
  if (tagName === undefined) issues.push('Missing or invalid tagName.');

  const rect = parseRect(record['rect']);
  if (rect === undefined) issues.push('Missing or invalid rect.');

  if (selector === undefined || tagName === undefined || rect === undefined) {
    return { ok: false, issues };
  }

  const rawCapturedAt = cleanText(record['capturedAt'], 40);
  const capturedAt =
    rawCapturedAt !== undefined && !Number.isNaN(Date.parse(rawCapturedAt))
      ? new Date(rawCapturedAt).toISOString()
      : new Date().toISOString();

  const schemaVersion = asFiniteNumber(record['schemaVersion']) ?? EVIDENCE_SCHEMA_VERSION;
  const target: ElementTarget = {
    schemaVersion,
    selector,
    tagName,
    rect,
    capturedAt
  };

  const tabId = asFiniteNumber(record['tabId']);
  if (tabId !== undefined) target.tabId = tabId;
  const pageId = asFiniteNumber(record['pageId']);
  if (pageId !== undefined) target.pageId = pageId;
  const url = cleanText(record['url'], 2048);
  if (url !== undefined) target.url = url;
  const uid = cleanText(record['uid'], 120);
  if (uid !== undefined) target.uid = uid;
  const role = cleanText(record['role'], 60);
  if (role !== undefined) target.role = role;
  const accessibleName = cleanText(record['accessibleName']);
  if (accessibleName !== undefined) target.accessibleName = accessibleName;
  const textHint = cleanText(record['textHint']);
  if (textHint !== undefined) target.textHint = textHint;
  const viewport = parseDimensions(record['viewport']);
  if (viewport !== undefined) target.viewport = viewport;

  return { ok: true, target, issues };
}

/** Human-readable label for the Side Panel: `button "Guardar"`. */
export function elementTargetLabel(target: ElementTarget): string {
  const name = target.accessibleName ?? target.textHint;
  return name === undefined ? target.tagName : `${target.tagName} "${name}"`;
}

/**
 * Seeds `RawElementSource` from a selection so evidence collection can enrich it through the
 * Chrome DevTools MCP. Only facts the picker really observed are copied.
 */
export function elementTargetToEvidenceSeed(target: ElementTarget): RawElementSource {
  return {
    pageId: target.pageId ?? 0,
    uid: target.uid,
    url: target.url,
    tagName: target.tagName,
    role: target.role,
    accessibleName: target.accessibleName,
    textHint: target.textHint,
    geometry: target.rect,
    viewport: target.viewport,
    source: { toolName: 'element-picker' }
  };
}
