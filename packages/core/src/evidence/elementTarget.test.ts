import { describe, expect, it } from 'vitest';

import {
  elementTargetLabel,
  elementTargetToEvidenceSeed,
  normalizeElementTarget
} from './elementTarget.js';
import { normalizeElementEvidence } from './normalizeElementEvidence.js';

const validPayload = {
  selector: '#checkout > form > button.btn.btn-primary',
  tagName: 'BUTTON',
  rect: { x: 120, y: 480, width: 140, height: 40 },
  url: 'https://app.test/checkout',
  role: 'button',
  accessibleName: 'Guardar',
  textHint: 'Guardar',
  viewport: { width: 1440, height: 900 },
  tabId: 12,
  capturedAt: '2026-09-17T09:00:00.000Z'
};

describe('element target validation (DS-012)', () => {
  it('accepts a well-formed picker payload and normalizes the tag', () => {
    const result = normalizeElementTarget(validPayload);

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.target?.tagName).toBe('button');
    expect(result.target?.selector).toBe('#checkout > form > button.btn.btn-primary');
    expect(result.target?.capturedAt).toBe('2026-09-17T09:00:00.000Z');
    expect(result.target?.rect).toEqual({ x: 120, y: 480, width: 140, height: 40 });
  });

  it('rejects untrusted or incomplete payloads instead of guessing', () => {
    expect(normalizeElementTarget(null).ok).toBe(false);
    expect(normalizeElementTarget('button').ok).toBe(false);

    const missingRect = normalizeElementTarget({ selector: 'button', tagName: 'button' });
    expect(missingRect.ok).toBe(false);
    expect(missingRect.issues).toContain('Missing or invalid rect.');

    const badTag = normalizeElementTarget({ ...validPayload, tagName: 'button onclick=alert(1)' });
    expect(badTag.ok).toBe(false);

    const negativeSize = normalizeElementTarget({ ...validPayload, rect: { x: 0, y: 0, width: -5, height: 10 } });
    expect(negativeSize.ok).toBe(false);
  });

  it('sanitizes text coming from page content', () => {
    const result = normalizeElementTarget({
      ...validPayload,
      accessibleName: 'Guardar\u0000\n\u001b[31m now',
      textHint: 'x'.repeat(500)
    });

    expect(result.target?.accessibleName).toBe('Guardar [31m now');
    expect(result.target?.textHint?.length).toBe(280);
  });

  it('falls back to the current time when capturedAt is not a valid date', () => {
    const result = normalizeElementTarget({ ...validPayload, capturedAt: 'not-a-date' });
    expect(result.target?.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('labels targets for the Side Panel', () => {
    const target = normalizeElementTarget(validPayload).target;
    expect(target).toBeDefined();
    expect(elementTargetLabel(target!)).toBe('button "Guardar"');
    expect(elementTargetLabel({ ...target!, accessibleName: undefined })).toBe('button "Guardar"');
    expect(
      elementTargetLabel({ ...target!, accessibleName: undefined, textHint: undefined })
    ).toBe('button');
  });

  it('seeds evidence collection from the selection without inventing facts', () => {
    const target = normalizeElementTarget(validPayload).target;
    const seed = elementTargetToEvidenceSeed(target!);

    expect(seed.tagName).toBe('button');
    expect(seed.geometry).toEqual({ x: 120, y: 480, width: 140, height: 40 });
    expect(seed.computedStyles).toBeUndefined();
    expect(seed.classNames).toBeUndefined();

    const evidence = normalizeElementEvidence(seed);
    expect(evidence.kind).toBe('observed');
    expect(evidence.tagName).toBe('button');
    expect(evidence.source?.toolName).toBe('element-picker');
    expect(evidence.computedStyle).toBeUndefined();
  });
});
