import type { ComponentSignature, PageElementEvidence } from '@desaignsync/shared-types';
import { describe, expect, it } from 'vitest';

import { CLASS_SIGNAL_WEIGHT_CAP } from '../evidence/classNormalizer.js';
import {
  DEFAULT_MATCHING_WEIGHTS,
  MIN_EVIDENCE_COVERAGE,
  MatchingEngine,
  explainMatchResult,
  matchElement,
  resolveMatchingConfig
} from './matchingEngine.js';

const elementEvidence = (overrides: Partial<PageElementEvidence> = {}): PageElementEvidence => ({
  schemaVersion: 1,
  kind: 'observed',
  pageId: 42,
  ...overrides
});

const signature = (
  overrides: Partial<ComponentSignature> & Pick<ComponentSignature, 'id' | 'component'>
): ComponentSignature => ({
  schemaVersion: 1,
  sourceMcp: 'storybook-ds',
  kind: 'observed',
  providedFields: [],
  retrievedAt: '2026-09-17T00:00:00.000Z',
  ...overrides
});

const buttonPrimary = signature({
  id: 'button-primary',
  component: 'Button',
  variant: 'Primary',
  semanticRole: 'button',
  expectedTags: ['button'],
  classKeywords: ['button', 'primary'],
  states: ['disabled'],
  structure: { hasLabel: false, hasIcon: false },
  styles: {
    backgroundColor: '#0057b8',
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 600,
    borderRadius: 8,
    height: 40,
    padding: { top: 8, right: 16, bottom: 8, left: 16 }
  },
  documentation: 'Use Button for primary actions.'
});

const buttonSecondary = signature({
  id: 'button-secondary',
  component: 'Button',
  variant: 'Secondary',
  semanticRole: 'button',
  expectedTags: ['button'],
  classKeywords: ['button', 'secondary'],
  structure: { hasLabel: false, hasIcon: false },
  styles: { backgroundColor: '#f3f4f6', color: '#1f2937', borderRadius: 8, height: 40 }
});

const inputText = signature({
  id: 'input-text',
  component: 'Input',
  semanticRole: 'textbox',
  expectedTags: ['input'],
  expectedInputTypes: ['text', 'email'],
  classKeywords: ['input'],
  structure: { hasLabel: true },
  styles: { borderRadius: 6, height: 36 }
});

const observedButton: PageElementEvidence = elementEvidence({
  uid: 'uid-button-1',
  tagName: 'button',
  role: 'button',
  accessibleName: 'Guardar',
  classNames: ['btn', 'btn-primary'],
  normalizedClassTokens: ['btn', 'primary'],
  attributes: { type: 'button' },
  childSummary: [],
  computedStyle: {
    backgroundColor: '#0057b8',
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 600,
    borderRadius: 8,
    height: 40,
    padding: { top: 8, right: 16, bottom: 8, left: 16 }
  },
  geometry: { x: 0, y: 0, width: 96, height: 40 }
});

describe('matching engine (DS-014)', () => {
  it('ranks the matching variant first and penalizes semantic contradictions', () => {
    const result = matchElement(observedButton, [inputText, buttonSecondary, buttonPrimary]);

    expect(result.candidates.map((candidate) => candidate.variantName ?? candidate.componentName)).toEqual([
      'Primary',
      'Secondary',
      'Input'
    ]);
    expect(result.outcome).toBe('primary');
    expect(result.selected?.componentName).toBe('Button');

    const input = result.candidates[2];
    expect(input?.contradiction).toBe(true);
    expect(input?.confidence).toBeLessThan(result.candidates[1]?.confidence ?? 0);
    expect(input?.reasons.join(' ')).toMatch(/contradiction/);
  });

  it('keeps every candidate explainable: the breakdown sums to the confidence', () => {
    const candidate = matchElement(observedButton, [buttonPrimary]).candidates[0];
    const sum = candidate?.breakdown.reduce((total, entry) => total + entry.weighted, 0) ?? 0;

    expect(candidate?.confidence).toBeGreaterThan(0.8);
    expect(candidate?.confidence).toBeLessThan(0.95);
    expect(sum).toBeCloseTo(candidate?.confidence ?? 0, 3);
    expect(candidate?.evidenceCoverage).toBeGreaterThanOrEqual(MIN_EVIDENCE_COVERAGE);
  });

  it('only reaches the primary band with broad coverage plus corroboration', () => {
    const richEvidence: PageElementEvidence = {
      ...observedButton,
      textHint: 'primary actions',
      computedStyle: { ...observedButton.computedStyle, borderColor: '#0057b8' }
    };

    const result = matchElement(richEvidence, [buttonPrimary], {
      llmHints: [{ signatureId: 'button-primary', score: 1, rationale: 'native button with primary styling' }]
    });

    expect(result.outcome).toBe('primary');
    expect(result.llmUsed).toBe(true);
    expect(result.selected?.llmInterpretation).toContain('native button');
    expect(result.selected?.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('never lets class names identify a component on their own (AC-22)', () => {
    const divWithClass = elementEvidence({
      tagName: 'div',
      classNames: ['btn-primary'],
      normalizedClassTokens: ['primary']
    });

    const result = matchElement(divWithClass, [buttonPrimary]);
    const classes = result.candidates[0]?.breakdown.find((entry) => entry.signal === 'classes');
    const structure = result.candidates[0]?.breakdown.find((entry) => entry.signal === 'structure');

    expect(classes?.score).toBeGreaterThan(0);
    expect(structure?.unavailable).toBe(true);
    expect(result.candidates[0]?.confidence).toBeLessThan(0.4);
    expect(result.outcome).toBe('no-reliable-match');
  });

  it('treats an LLM hint as one bounded signal, never as identity', () => {
    const bare = elementEvidence({ tagName: 'div' });
    const result = matchElement(bare, [buttonPrimary], {
      llmHints: [{ signatureId: 'button-primary', score: 1, rationale: 'looks like a button' }]
    });

    expect(result.llmUsed).toBe(true);
    expect(result.candidates[0]?.confidence).toBeLessThan(0.3);
    expect(result.outcome).toBe('no-reliable-match');
  });

  it('reports no reliable match when no candidates are supplied', () => {
    const result = matchElement(observedButton, []);

    expect(result.outcome).toBe('no-reliable-match');
    expect(result.candidates).toHaveLength(0);
    expect(result.selected).toBeUndefined();
    expect(result.notes.join(' ')).toContain('no Design System candidates');
  });

  it('honors expert configuration: minimum confidence and top-N candidates', () => {
    const engine = new MatchingEngine({ minConfidence: 0.9 });
    const strict = engine.match(observedButton, [buttonPrimary, buttonSecondary, inputText]);

    expect(strict.minConfidence).toBe(0.9);
    expect(strict.outcome).toBe('no-reliable-match');
    expect(strict.notes.join(' ')).toContain('below the configured minimum');

    const limited = matchElement(observedButton, [buttonPrimary, buttonSecondary, inputText], {
      config: { maxCandidates: 1 }
    });
    expect(limited.candidates).toHaveLength(1);
  });

  it('caps the class weight even when an expert sets an invalid value', () => {
    const config = resolveMatchingConfig({
      weights: { ...DEFAULT_MATCHING_WEIGHTS, classes: 5 }
    });

    expect(config.weights.classes).toBe(CLASS_SIGNAL_WEIGHT_CAP);
  });

  it('produces a readable explanation with per-signal contributions', () => {
    const lines = explainMatchResult(matchElement(observedButton, [buttonPrimary, inputText]));

    expect(lines[0]).toContain('Button / Primary');
    expect(lines[0]).toContain('confidence');
    expect(lines.join('\n')).toContain('semantic');
  });
});
