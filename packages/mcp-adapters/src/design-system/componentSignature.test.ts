import type { DesignSystemComponent } from '@desaignsync/shared-types';
import { describe, expect, it } from 'vitest';

import {
  candidateFromSignature,
  signatureCoverage,
  signatureSearchText,
  SIGNATURE_SCHEMA_VERSION,
  toComponentSignature,
  toComponentSignatures
} from './componentSignature.js';

const button: DesignSystemComponent = {
  id: 'button-primary',
  componentName: 'Button',
  variantName: 'Primary',
  description: 'Primary action trigger.',
  roles: ['button'],
  props: {
    variant: { type: 'string' },
    label: { type: 'string' },
    icon: { type: 'string' },
    disabled: { type: 'boolean' }
  },
  usageGuidelines: 'Use Button for primary actions.',
  referenceStyles: {
    backgroundColor: '#0057b8',
    borderRadius: 8,
    height: 40,
    fontSize: 14,
    fontWeight: 600,
    color: '#ffffff'
  },
  storyOrPreviewRef: 'storybook://button--primary',
  sourceMcp: 'storybook-ds'
};

describe('component signature (DS-013, spec §11)', () => {
  it('maps a full Design System component into a comparable signature', () => {
    const signature = toComponentSignature(button, { sourceMcp: 'storybook-ds' });

    expect(signature.schemaVersion).toBe(SIGNATURE_SCHEMA_VERSION);
    expect(signature.kind).toBe('observed');
    expect(signature.component).toBe('Button');
    expect(signature.variant).toBe('Primary');
    expect(signature.semanticRole).toBe('button');
    expect(signature.expectedTags).toEqual(['button']);
    expect(signature.classKeywords).toEqual(['button', 'primary']);
    expect(signature.states).toEqual(['disabled']);
    expect(signature.structure).toEqual({ hasLabel: true, hasIcon: true });
    expect(signature.documentation).toBe('Use Button for primary actions.');
    expect(signature.visualReferenceRef).toBe('storybook://button--primary');
    expect(signature.styles).toEqual({
      backgroundColor: '#0057b8',
      borderRadius: 8,
      height: 40,
      fontSize: 14,
      fontWeight: 600,
      color: '#ffffff'
    });
    expect(signature.providedFields).toEqual(
      expect.arrayContaining([
        'id',
        'componentName',
        'variantName',
        'description',
        'roles',
        'props',
        'usageGuidelines',
        'referenceStyles',
        'storyOrPreviewRef'
      ])
    );
    expect(signature.derivedFields).toContain('expectedTags');
    expect(signatureCoverage(signature)).toBe(1);
  });

  it('never invents properties for a partially documented component', () => {
    const signature = toComponentSignature(
      { id: 'card', componentName: 'Card', sourceMcp: 'fixture-ds' },
      { sourceMcp: 'fixture-ds' }
    );

    expect(signature.component).toBe('Card');
    expect(signature.variant).toBeUndefined();
    expect(signature.semanticRole).toBeUndefined();
    expect(signature.expectedTags).toBeUndefined();
    expect(signature.styles).toBeUndefined();
    expect(signature.states).toBeUndefined();
    expect(signature.documentation).toBeUndefined();
    expect(signature.visualReferenceRef).toBeUndefined();
    expect(signature.classKeywords).toEqual(['card']);
    expect(signatureCoverage(signature)).toBeLessThan(0.3);
    expect(JSON.stringify(signature)).not.toContain('backgroundColor');
  });

  it('derives input types and states only from documented props', () => {
    const signature = toComponentSignature(
      {
        id: 'input',
        componentName: 'Input',
        roles: ['textbox'],
        props: { type: ['email', 'password', 'silly'], required: { type: 'boolean' } },
        sourceMcp: 'fixture-ds'
      },
      { sourceMcp: 'fixture-ds' }
    );

    expect(signature.expectedInputTypes).toEqual(['email', 'password']);
    expect(signature.states).toEqual(['required']);
    expect(signature.expectedTags).toEqual(['input']);
  });

  it('maps lists of components and resolves provenance', () => {
    const signatures = toComponentSignatures([button], { sourceMcp: 'storybook-ds' });
    expect(signatures).toHaveLength(1);
    expect(signatures[0]?.sourceMcp).toBe('storybook-ds');
    expect(signatures[0]?.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('builds candidates and search text for the matching engine', () => {
    const signature = toComponentSignature(button, { sourceMcp: 'storybook-ds' });
    const candidate = candidateFromSignature(signature);

    expect(candidate).toEqual({
      componentId: 'button-primary',
      componentName: 'Button',
      variantName: 'Primary',
      sourceMcp: 'storybook-ds',
      signatureId: 'button-primary',
      summary: 'Use Button for primary actions.'
    });
    expect(Object.keys(candidate)).not.toContain('classKeywords');
    expect(signatureSearchText(signature)).toContain('Button');
    expect(signatureSearchText(signature)).toContain('primary');
  });
});
