import { describe, expect, it } from 'vitest';

import {
  CLASS_SIGNAL_WEIGHT_CAP,
  isHashLikeToken,
  normalizeClassNames
} from './classNormalizer.js';

const tokensOf = (classes: string[], category: string): string[] =>
  normalizeClassNames(classes)
    .tokens.filter((token) => token.category === category)
    .map((token) => token.token);

describe('class normalizer (DS-011, spec §12.1 examples)', () => {
  it('keeps raw classes and classifies semantic + variant tokens', () => {
    const result = normalizeClassNames(['btn', 'btn-primary']);
    expect(result.rawClasses).toEqual(['btn', 'btn-primary']);
    expect(result.semanticTokens).toEqual(['btn', 'primary']);
    expect(tokensOf(['btn'], 'semantic')).toEqual(['btn']);
    expect(tokensOf(['btn-primary'], 'variant')).toEqual(['primary']);
    expect(result.onlyNoise).toBe(false);
    expect(result.signalStrength).toBe(1);
  });

  it('does not turn a styled div into a component by class alone', () => {
    // `btn-primary` on a div yields class evidence, but AC-22 requires corroboration.
    const result = normalizeClassNames(['btn-primary']);
    expect(result.semanticTokens).toContain('primary');
    expect(result.signalStrength).toBeLessThanOrEqual(1);
    expect(result.onlyNoise).toBe(false);
  });

  it('marks the form-control wrapper as structural context, not the control itself', () => {
    const result = normalizeClassNames(['form-control-wrapper']);
    expect(result.semanticTokens).toEqual(['form']);
    expect(tokensOf(['form-control-wrapper'], 'structural')).toEqual(['control', 'wrapper']);
  });

  it('splits CSS Modules names and drops the generated hash', () => {
    const result = normalizeClassNames(['Button_root__a8K3x']);
    expect(result.semanticTokens).toContain('button');
    expect(tokensOf(['Button_root__a8K3x'], 'structural')).toContain('root');
    expect(result.hashedClassCount).toBeGreaterThanOrEqual(1);
    expect(result.semanticTokens).not.toContain('a8k3x');
  });

  it('drops underscores and suffixes in generated class names', () => {
    const result = normalizeClassNames(['_button_x71k9', 'styles_button__23Xa']);
    expect(result.semanticTokens).toContain('button');
    expect(result.semanticTokens).not.toContain('x71k9');
    const generated = result.tokens.filter((token) => token.token === 'x71k9');
    expect(generated).toHaveLength(1);
    expect(generated[0]?.category).toBe('generated');
    expect(generated[0]?.weight).toBeLessThan(0.2);
  });

  it('treats purely generated class names as noise', () => {
    const result = normalizeClassNames(['css-4j8f92', 'sc-aXZVg']);
    expect(result.onlyNoise).toBe(true);
    expect(result.semanticTokens).toEqual([]);
    expect(result.signalStrength).toBeLessThanOrEqual(0.2);
    expect(result.hashedClassCount).toBe(1);
  });

  it('never treats utility classes as identity evidence', () => {
    const result = normalizeClassNames(['flex', 'gap-2', 'px-4', 'text-sm']);
    expect(result.onlyNoise).toBe(true);
    expect(result.utilityClassCount).toBe(4);
    expect(result.signalStrength).toBe(0.1);
  });

  it('handles state tokens such as disabled/invalid and size variants', () => {
    const result = normalizeClassNames(['input-error', 'is-disabled', 'field-lg']);
    expect(result.semanticTokens).toContain('input');
    expect(result.semanticTokens).toContain('error');
    expect(result.semanticTokens).toContain('disabled');
    expect(result.semanticTokens).toContain('field');
    expect(result.semanticTokens).toContain('lg');
  });

  it('recognizes responsive-prefixed classes as utilities', () => {
    const result = normalizeClassNames(['md:flex']);
    expect(result.onlyNoise).toBe(true);
    expect(result.utilityClassCount).toBe(1);
  });

  it('exposes the class contribution cap so matching can downweight it', () => {
    expect(CLASS_SIGNAL_WEIGHT_CAP).toBeGreaterThan(0);
    expect(CLASS_SIGNAL_WEIGHT_CAP).toBeLessThanOrEqual(0.15);
  });

  it('detects hash-like fragments', () => {
    expect(isHashLikeToken('4j8f92')).toBe(true);
    expect(isHashLikeToken('a8k3x')).toBe(true);
    expect(isHashLikeToken('deadbeef')).toBe(true);
    expect(isHashLikeToken('button')).toBe(false);
    expect(isHashLikeToken('primary')).toBe(false);
  });

  it('is defensive with empty input and whitespace', () => {
    const result = normalizeClassNames(['', '   ']);
    expect(result.rawClasses).toEqual([]);
    expect(result.semanticTokens).toEqual([]);
    expect(result.signalStrength).toBe(0);
    expect(result.onlyNoise).toBe(true);
  });
});
