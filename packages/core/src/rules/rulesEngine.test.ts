import { CHECK_IDS, type CheckConfig, type Finding, type PageElementEvidence } from '@desaignsync/shared-types';
import { describe, expect, it } from 'vitest';

import {
  CHECK_DEFINITIONS,
  DEFAULT_CHECKS,
  RulesEngine,
  evaluateRules,
  summarizeFindings,
  type RuleReference
} from './rulesEngine.js';

const observedButton: PageElementEvidence = {
  schemaVersion: 1,
  kind: 'observed',
  pageId: 7,
  uid: 'uid-button-1',
  tagName: 'button',
  role: 'button',
  accessibleName: 'Guardar',
  attributes: { type: 'button' },
  computedStyle: {
    color: '#ffffff',
    backgroundColor: '#0057b8',
    fontFamily: 'Inter, sans-serif',
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'solid',
    padding: { top: 12, right: 16, bottom: 12, left: 16 },
    height: 40,
    width: 120
  },
  disabled: false
};

const buttonReference: RuleReference = {
  tags: ['button'],
  role: 'button',
  color: '#ffffff',
  backgroundColor: '#0057b8',
  fontFamily: 'Inter, sans-serif',
  fontSize: 14,
  fontWeight: 600,
  lineHeight: 20,
  borderRadius: 8,
  borderWidth: 1,
  borderStyle: 'solid',
  padding: { top: 12, right: 16, bottom: 12, left: 16 },
  height: 40,
  states: ['disabled']
};

const byRule = (findings: readonly Finding[], ruleId: string): Finding | undefined =>
  findings.find((finding) => finding.ruleId === ruleId);

describe('rules engine (DS-015)', () => {
  it('registers a default configuration for every declared check', () => {
    expect(Object.keys(DEFAULT_CHECKS).sort()).toEqual([...CHECK_IDS].sort());
    expect(CHECK_DEFINITIONS.map((definition) => definition.id).sort()).toEqual([...CHECK_IDS].sort());
  });

  it('passes every check that has comparable data, without inventing failures', () => {
    const findings = evaluateRules({
      evidence: observedButton,
      reference: buttonReference,
      matchConfidence: 0.92,
      evidenceRefs: ['evidence-1'],
      sourceMcpRefs: ['storybook-ds']
    });
    const summary = summarizeFindings(findings);

    expect(summary.FAIL).toBe(0);
    expect(byRule(findings, 'color.background')?.status).toBe('PASS');
    expect(byRule(findings, 'typography.fontSize')?.status).toBe('PASS');
    expect(byRule(findings, 'shape.borderRadius')?.status).toBe('PASS');
    expect(byRule(findings, 'accessibility.role')?.status).toBe('PASS');
    expect(byRule(findings, 'accessibility.contrast')?.status).toBe('PASS');
    expect(byRule(findings, 'component.matching')?.status).toBe('PASS');
    expect(findings.every((finding) => finding.interpretedByLlm === false)).toBe(true);
    expect(findings.every((finding) => finding.evidenceRefs.includes('evidence-1'))).toBe(true);
    expect(findings.every((finding) => finding.sourceMcpRefs?.includes('storybook-ds'))).toBe(true);

    // Data that simply does not exist stays NOT_EVALUATED.
    expect(byRule(findings, 'spacing.margin')?.status).toBe('NOT_EVALUATED');
    expect(byRule(findings, 'shape.shadow')?.status).toBe('NOT_EVALUATED');
    expect(byRule(findings, 'dimensions.width')?.status).toBe('NOT_EVALUATED');
    expect(byRule(findings, 'accessibility.label')?.status).toBe('NOT_EVALUATED');
  });

  it('never turns missing evidence into a FAIL', () => {
    const findings = evaluateRules({ evidence: { schemaVersion: 1, kind: 'unknown', pageId: 1 } });
    const summary = summarizeFindings(findings);

    expect(findings).toHaveLength(CHECK_IDS.length);
    expect(summary.FAIL).toBe(0);
    expect(summary.NOT_EVALUATED).toBe(CHECK_IDS.length);
  });

  it('applies tolerances: spacing ±2px and radius ±1px pass inside the band', () => {
    const withinTolerance = evaluateRules({
      evidence: {
        ...observedButton,
        computedStyle: { ...observedButton.computedStyle, padding: { top: 14, right: 16, bottom: 14, left: 16 }, borderRadius: 9 }
      },
      reference: buttonReference
    });
    expect(byRule(withinTolerance, 'spacing.padding')?.status).toBe('PASS');
    expect(byRule(withinTolerance, 'shape.borderRadius')?.status).toBe('PASS');

    const outsideTolerance = evaluateRules({
      evidence: {
        ...observedButton,
        computedStyle: { ...observedButton.computedStyle, padding: { top: 15, right: 16, bottom: 15, left: 16 }, borderRadius: 10 }
      },
      reference: buttonReference
    });
    expect(byRule(outsideTolerance, 'spacing.padding')?.status).toBe('FAIL');
    expect(byRule(outsideTolerance, 'shape.borderRadius')?.status).toBe('FAIL');
  });

  it('computes WCAG contrast and honors a custom threshold', () => {
    const lowContrast = evaluateRules({
      evidence: { ...observedButton, computedStyle: { ...observedButton.computedStyle, color: '#777777', backgroundColor: '#ffffff' } },
      reference: buttonReference
    });
    const finding = byRule(lowContrast, 'accessibility.contrast');
    expect(finding?.status).toBe('FAIL');
    expect(finding?.observed).toMatchObject({ ratio: 4.48 });

    const relaxed: CheckConfig = {
      enabled: true,
      severity: 'major',
      tolerance: { strategy: 'numeric-absolute', absolute: 4 }
    };
    const relaxedResult = evaluateRules(
      {
        evidence: { ...observedButton, computedStyle: { ...observedButton.computedStyle, color: '#777777', backgroundColor: '#ffffff' } },
        reference: buttonReference
      },
      { checks: { 'accessibility.contrast': relaxed } }
    );
    expect(byRule(relaxedResult, 'accessibility.contrast')?.status).toBe('PASS');
  });

  it('reports non-native semantics as REVIEW and conflicting semantics as FAIL', () => {
    const styledDiv = evaluateRules({
      evidence: { ...observedButton, tagName: 'div', role: 'button' },
      reference: buttonReference
    });
    const roleFinding = byRule(styledDiv, 'accessibility.role');
    expect(roleFinding?.status).toBe('REVIEW');
    expect(roleFinding?.explanation).toContain('native tag');

    const wrongSemantics = evaluateRules({
      evidence: { ...observedButton, tagName: 'div', role: 'textbox' },
      reference: buttonReference
    });
    expect(byRule(wrongSemantics, 'accessibility.role')?.status).toBe('FAIL');
  });

  it('flags states the reference does not declare and skips uncaptured states', () => {
    const undeclaredState = evaluateRules({
      evidence: { ...observedButton, disabled: true },
      reference: { ...buttonReference, states: [] }
    });
    expect(byRule(undeclaredState, 'accessibility.disabledState')?.status).toBe('FAIL');

    const declaredState = evaluateRules({
      evidence: { ...observedButton, disabled: true },
      reference: buttonReference
    });
    expect(byRule(declaredState, 'accessibility.disabledState')?.status).toBe('PASS');

    const unknownState = evaluateRules({
      evidence: { ...observedButton, disabled: undefined },
      reference: buttonReference
    });
    expect(byRule(unknownState, 'accessibility.disabledState')?.status).toBe('NOT_EVALUATED');
  });

  it('maps match confidence onto the inferred component check', () => {
    const confidenceOf = (matchConfidence: number): Finding | undefined =>
      byRule(evaluateRules({ evidence: observedButton, reference: buttonReference, matchConfidence }), 'component.matching');

    expect(confidenceOf(0.92)?.status).toBe('PASS');
    expect(confidenceOf(0.7)?.status).toBe('REVIEW');
    const unreliable = confidenceOf(0.3);
    expect(unreliable?.status).toBe('REVIEW');
    expect(unreliable?.explanation).toContain('no reliable match');
  });

  it('respects disabled checks and severity overrides from a profile', () => {
    const findings = evaluateRules(
      {
        evidence: { ...observedButton, computedStyle: { ...observedButton.computedStyle, color: '#000000' } },
        reference: buttonReference
      },
      {
        checks: {
          'color.text': { enabled: false, severity: 'minor', tolerance: { strategy: 'exact' } },
          'spacing.padding': {
            enabled: true,
            severity: 'critical',
            tolerance: { strategy: 'numeric-absolute', absolute: 0 }
          }
        }
      }
    );

    expect(byRule(findings, 'color.text')).toBeUndefined();
    expect(byRule(findings, 'spacing.padding')?.severity).toBe('critical');
  });

  it('exposes a serializable result', () => {
    const findings = evaluateRules({ evidence: observedButton, reference: buttonReference });
    expect(JSON.parse(JSON.stringify(findings))).toEqual(findings);
  });

  it('supports profile switching through the stateful facade', () => {
    const engine = new RulesEngine({
      checks: { 'color.text': { enabled: false, severity: 'minor', tolerance: { strategy: 'exact' } } }
    });
    expect(byRule(engine.evaluate({ evidence: observedButton, reference: buttonReference }), 'color.text')).toBeUndefined();

    const restored = engine.withChecks({
      'color.text': { enabled: true, severity: 'major', tolerance: { strategy: 'exact' } }
    });
    expect(byRule(restored.evaluate({ evidence: observedButton, reference: buttonReference }), 'color.text')?.status).toBe(
      'PASS'
    );
  });
});
