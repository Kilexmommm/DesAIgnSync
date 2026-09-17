import { EVIDENCE_SCHEMA_VERSION } from '@desaignsync/shared-types';
import { describe, expect, it } from 'vitest';

import {
  asColor,
  asNonEmptyString,
  evidenceCoverage,
  normalizeElementEvidence,
  parseBox,
  parseCssNumber,
  summarizeEvidence
} from './normalizeElementEvidence.js';

describe('element evidence normalization (DS-010, AC-21)', () => {
  it('captures tag, role, input type, raw classes and normalized tokens', () => {
    const evidence = normalizeElementEvidence({
      pageId: 7,
      uid: 'uid-42',
      url: 'https://app.test/checkout',
      tagName: 'INPUT',
      role: 'textbox',
      accessibleName: 'Work email',
      inputType: 'EMAIL',
      attributes: { name: 'email', autocomplete: 'email', ignored: { nested: true } },
      classNames: ['form-control', 'field-lg'],
      ariaState: { 'aria-required': 'true' },
      labelTexts: ['Work email'],
      required: true,
      computedStyles: {
        color: 'rgb(31, 41, 55)',
        backgroundColor: '#ffffff',
        fontFamily: 'Inter, sans-serif',
        fontSize: '14px',
        fontWeight: '500',
        lineHeight: '1.5',
        padding: '8px 16px',
        borderRadius: '6px',
        borderWidth: '1px',
        display: 'block',
        width: '320px'
      },
      geometry: { x: 10, y: 20, width: 320, height: 40 },
      viewport: { width: 1440, height: 900 },
      source: { inspectionMcpId: 'chrome-devtools', toolName: 'take_snapshot' },
      snapshotExcerpt: '- textbox "Work email" [uid=uid-42]'
    });

    expect(evidence.schemaVersion).toBe(EVIDENCE_SCHEMA_VERSION);
    expect(evidence.kind).toBe('observed');
    expect(evidence.tagName).toBe('input');
    expect(evidence.inputType).toBe('email');
    expect(evidence.role).toBe('textbox');
    expect(evidence.classNames).toEqual(['form-control', 'field-lg']);
    expect(evidence.normalizedClassTokens).toEqual(['form', 'field', 'lg']);
    expect(evidence.labelRefs).toEqual(['Work email']);
    expect(evidence.required).toBe(true);
    expect(evidence.ariaState).toEqual({ 'aria-required': 'true' });
    expect(evidence.computedStyle?.fontSize).toBe(14);
    expect(evidence.computedStyle?.fontWeight).toBe(500);
    expect(evidence.computedStyle?.padding).toEqual({ top: 8, right: 16, bottom: 8, left: 16 });
    expect(evidence.geometry).toEqual({ x: 10, y: 20, width: 320, height: 40 });
    expect(evidence.viewport).toEqual({ width: 1440, height: 900 });
    expect(evidence.source).toEqual({ inspectionMcpId: 'chrome-devtools', toolName: 'take_snapshot' });
  });

  it('drops non-primitive attributes and keeps observed keys only', () => {
    const evidence = normalizeElementEvidence({
      pageId: 1,
      tagName: 'div',
      attributes: { id: 'root', empty: '  ', data: [1, 2], nested: { a: 1 } }
    });

    expect(evidence.attributes).toEqual({ id: 'root' });
  });

  it('never invents data: an empty descriptor stays unknown', () => {
    const evidence = normalizeElementEvidence({ pageId: 1 });

    expect(evidence.kind).toBe('unknown');
    expect(evidence.computedStyle).toBeUndefined();
    expect(evidence.geometry).toBeUndefined();
    expect(evidence.classNames).toBeUndefined();
    expect(JSON.stringify(evidence)).not.toContain('color');
  });

  it('keeps non-px and keyword CSS values unknown instead of guessing', () => {
    expect(parseCssNumber('14px')).toBe(14);
    expect(parseCssNumber('1.5rem')).toBeUndefined();
    expect(parseCssNumber('100%')).toBeUndefined();
    expect(parseCssNumber('auto')).toBeUndefined();
    expect(parseCssNumber(600)).toBe(600);
  });

  it('parses color and box shorthands defensively', () => {
    expect(asColor('#0057B8')).toBe('#0057B8');
    expect(asColor('rgb(0, 87, 184)')).toBe('rgb(0, 87, 184)');
    expect(asColor('14px')).toBeUndefined();
    expect(parseBox('8px 16px')).toEqual({ top: 8, right: 16, bottom: 8, left: 16 });
    expect(parseBox('4px')).toEqual({ top: 4, right: 4, bottom: 4, left: 4 });
    expect(parseBox({ top: 1, right: 2, bottom: 3, left: 4 })).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
    expect(parseBox('8px 1rem')).toBeUndefined();
  });

  it('reports evidence coverage so insufficient evidence becomes REVIEW, not FAIL', () => {
    const sparse = evidenceCoverage(normalizeElementEvidence({ pageId: 1, tagName: 'button' }));
    expect(sparse.presentFields).toContain('tagName');
    expect(sparse.missingFields).toContain('computedStyle');
    expect(sparse.ratio).toBeGreaterThan(0);
    expect(sparse.ratio).toBeLessThan(1);

    const rich = evidenceCoverage(
      normalizeElementEvidence({
        pageId: 1,
        uid: 'u1',
        tagName: 'button',
        role: 'button',
        accessibleName: 'Save',
        inputType: 'submit',
        attributes: { type: 'submit' },
        classNames: ['btn', 'btn-primary'],
        computedStyles: { color: '#fff' },
        geometry: { x: 0, y: 0, width: 10, height: 10 },
        parentContext: { tagName: 'form' },
        childSummary: [{ tagName: 'span' }],
        screenshotRef: 'shot-1'
      })
    );
    expect(rich.missingFields).toEqual([]);
    expect(rich.ratio).toBe(1);
  });

  it('summarizes evidence without leaking raw attributes', () => {
    const summary = summarizeEvidence(
      normalizeElementEvidence({
        pageId: 3,
        tagName: 'input',
        inputType: 'password',
        classNames: ['input', 'input-password'],
        attributes: { value: 'super-secret-value' },
        computedStyles: { fontSize: '14px' }
      })
    );

    expect(summary['tag']).toBe('input');
    expect(summary['inputType']).toBe('password');
    expect(summary['classTokens']).toEqual(['input']);
    expect(summary['styleKeys']).toEqual(['fontSize']);
    expect(JSON.stringify(summary)).not.toContain('super-secret-value');
  });

  it('normalizes empty strings and numbers consistently', () => {
    expect(asNonEmptyString('  ')).toBeUndefined();
    expect(asNonEmptyString(42)).toBe('42');
    expect(asNonEmptyString(undefined)).toBeUndefined();
  });
});
