import type { ComponentSignature, PageElementEvidence } from '@desaignsync/shared-types';
import { describe, expect, it } from 'vitest';

import { normalizeElementEvidence } from '../evidence/normalizeElementEvidence.js';
import { createProfileFromTemplate, updateChecks } from '../profiles/profileCatalog.js';
import { assembleReview } from './reviewAssembler.js';
import { signatureToRuleReference } from './ruleReference.js';

const buttonPrimary: ComponentSignature = {
  schemaVersion: 1,
  id: 'button-primary',
  component: 'Button',
  variant: 'Primary',
  sourceMcp: 'storybook-ds',
  semanticRole: 'button',
  expectedTags: ['button'],
  classKeywords: ['button', 'primary'],
  states: ['disabled'],
  structure: { hasLabel: false, hasIcon: false },
  styles: {
    color: '#ffffff',
    backgroundColor: '#0057b8',
    fontFamily: 'Inter, sans-serif',
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 20,
    borderRadius: 8,
    borderWidth: 1,
    height: 40,
    padding: { top: 12, right: 16, bottom: 12, left: 16 }
  },
  documentation: 'Use Button for primary actions.',
  providedFields: ['id', 'componentName', 'variantName', 'roles', 'referenceStyles', 'usageGuidelines'],
  kind: 'observed',
  retrievedAt: '2026-09-17T00:00:00.000Z'
};

const collectButtonEvidence = (): PageElementEvidence =>
  normalizeElementEvidence({
    pageId: 1,
    uid: 'uid-button-1',
    url: 'https://example.test/',
    tagName: 'button',
    role: 'button',
    accessibleName: 'Guardar',
    attributes: { type: 'button' },
    classNames: ['btn', 'btn-primary'],
    labelTexts: [],
    childSummary: [],
    computedStyles: {
      color: '#ffffff',
      backgroundColor: '#0057b8',
      fontFamily: 'Inter, sans-serif',
      fontSize: '14px',
      fontWeight: '600',
      lineHeight: '20px',
      borderRadius: '8px',
      borderWidth: '1px',
      borderStyle: 'solid',
      height: '40px',
      width: '120px',
      margin: '0px',
      padding: '12px 16px'
    },
    geometry: { x: 0, y: 0, width: 120, height: 40 },
    viewport: { width: 1280, height: 800 },
    disabled: false
  });

const collectDivWithClass = (): PageElementEvidence =>
  normalizeElementEvidence({
    pageId: 1,
    tagName: 'div',
    classNames: ['btn-primary'],
    attributes: {},
    childSummary: []
  });

const profile = createProfileFromTemplate({ id: 'design-qa', templateId: 'design-qa' });

describe('review assembler (DS-018: OBSERVATION -> MATCHING -> VALIDATION)', () => {
  it('assembles a reliable Button/Primary match with deterministic checks', () => {
    const result = assembleReview({
      evidence: collectButtonEvidence(),
      signatures: [buttonPrimary],
      profile,
      evidenceRefs: ['evidence-1'],
      sourceMcpRefs: ['storybook-ds']
    });

    expect(result.match.selected?.componentName).toBe('Button');
    expect(result.match.selected?.variantName).toBe('Primary');
    expect(result.match.outcome).toBe('primary');
    expect(result.reference?.backgroundColor).toBe('#0057b8');
    expect(result.findings.find((f) => f.ruleId === 'color.background')?.status).toBe('PASS');
    expect(result.findings.find((f) => f.ruleId === 'spacing.padding')?.status).toBe('PASS');
    expect(result.findings.find((f) => f.ruleId === 'accessibility.role')?.status).toBe('PASS');
    expect(result.summary.FAIL).toBe(0);
    expect(result.warnings).toEqual([]);
    expect(result.findings[0]?.evidenceRefs).toEqual(['evidence-1']);
  });

  it('stays explainable when no candidate matches instead of forcing a component', () => {
    const result = assembleReview({
      evidence: collectButtonEvidence(),
      signatures: [],
      profile
    });

    expect(result.match.outcome).toBe('no-reliable-match');
    expect(result.match.selected).toBeUndefined();
    expect(result.reference).toBeUndefined();
    expect(result.match.confidence).toBeUndefined();
    expect(result.warnings.join(' ')).toContain('No reliable component match');
    // Reference-independent checks still run: the observed facts do not disappear.
    expect(result.findings.find((f) => f.ruleId === 'accessibility.contrast')?.status).toBe('PASS');
    expect(result.findings.find((f) => f.ruleId === 'color.background')?.status).toBe('NOT_EVALUATED');
  });

  it('projects only fields the Design System actually provided', () => {
    const partial: ComponentSignature = {
      schemaVersion: 1,
      id: 'card',
      component: 'Card',
      sourceMcp: 'storybook-ds',
      semanticRole: 'group',
      expectedTags: ['article'],
      states: ['selected'],
      props: { label: { type: 'string' }, alignment: 'start' } as ComponentSignature['props'],
      providedFields: ['id', 'componentName'],
      kind: 'observed',
      retrievedAt: '2026-09-17T00:00:00.000Z'
    };

    const reference = signatureToRuleReference(partial);
    expect(reference.role).toBe('group');
    expect(reference.tags).toEqual(['article']);
    expect(reference.states).toEqual(['selected']);
    // `label` is a prop definition, not a value: it must not become an expected accessible name.
    expect(reference.accessibleName).toBeUndefined();
    expect(reference.backgroundColor).toBeUndefined();
    expect(Object.keys(reference)).not.toContain('fontSize');
  });

  it('respects the profile check configuration without touching the prompt', () => {
    const withoutColorText = updateChecks(profile, { 'color.text': { enabled: false } });
    expect(withoutColorText.advancedInstructions).toBe(profile.advancedInstructions);

    const result = assembleReview({
      evidence: collectButtonEvidence(),
      signatures: [buttonPrimary],
      profile: withoutColorText
    });

    expect(result.findings.some((f) => f.ruleId === 'color.text')).toBe(false);
    expect(result.findings.some((f) => f.ruleId === 'color.background')).toBe(true);
  });

  it('uses LLM hints only as corroboration, never as the only signal', () => {
    const richWithoutHint = assembleReview({
      evidence: collectButtonEvidence(),
      signatures: [buttonPrimary],
      profile
    });
    const richWithHint = assembleReview({
      evidence: collectButtonEvidence(),
      signatures: [buttonPrimary],
      profile,
      matchHints: [{ signatureId: 'button-primary', score: 1, rationale: 'native button' }]
    });
    expect((richWithHint.match.confidence ?? 0) > (richWithoutHint.match.confidence ?? 0)).toBe(true);

    const weak = assembleReview({
      evidence: collectDivWithClass(),
      signatures: [buttonPrimary],
      profile,
      matchHints: [{ signatureId: 'button-primary', score: 1, rationale: 'looks like a button' }]
    });
    expect(weak.match.confidence ?? 0).toBeLessThan(0.85);
    expect(weak.match.outcome).not.toBe('primary');
  });

  it('reports evidence coverage so weak observations are visible', () => {
    const rich = assembleReview({ evidence: collectButtonEvidence(), signatures: [buttonPrimary], profile });
    const sparse = assembleReview({ evidence: collectDivWithClass(), signatures: [buttonPrimary], profile });

    expect(rich.evidenceCoverage).toBeGreaterThan(0.6);
    expect(sparse.evidenceCoverage).toBeLessThan(0.4);
  });
});
