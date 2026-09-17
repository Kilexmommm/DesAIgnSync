import { describe, expect, it } from 'vitest';

import {
  COLLECT_EVIDENCE_MARKER,
  buildElementEvidenceExpression,
  readCollectedDescriptor
} from './elementEvidenceCollector.js';

interface FakeElementOptions {
  tagName?: string;
  textContent?: string;
  attributes?: Record<string, string>;
  classNames?: string[];
  labels?: Array<{ textContent: string }>;
  children?: unknown[];
  disabled?: boolean;
}

const createFakeDom = (options: FakeElementOptions = {}) => {
  const mutations: string[] = [];
  const element = {
    tagName: (options.tagName ?? 'button').toUpperCase(),
    textContent: options.textContent ?? 'Guardar',
    classList: options.classNames ?? ['btn', 'btn-primary'],
    labels: options.labels,
    children: options.children ?? [],
    disabled: options.disabled ?? false,
    getAttribute: (name: string) => options.attributes?.[name] ?? null,
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 120, height: 40 }),
    setAttribute: () => mutations.push('setAttribute'),
    appendChild: () => mutations.push('appendChild'),
    remove: () => mutations.push('remove')
  };
  const style = {
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
    opacity: '1',
    display: 'inline-flex',
    paddingTop: '12px',
    paddingRight: '16px',
    paddingBottom: '12px',
    paddingLeft: '16px',
    marginTop: '0px',
    marginRight: '0px',
    marginBottom: '0px',
    marginLeft: '0px'
  };
  return {
    mutations,
    document: { querySelector: (selector: string) => (selector === '#save' ? element : null) },
    window: { getComputedStyle: () => style, innerWidth: 1280, innerHeight: 800 }
  };
};

const evaluate = (expression: string, documentStub: unknown, windowStub: unknown): unknown =>
  new Function('document', 'window', `return ${expression};`)(documentStub, windowStub) as unknown;

describe('Chrome element evidence collector (DS-005 -> DS-010)', () => {
  it('builds a self-contained expression with the marker and the selector literal', () => {
    const expression = buildElementEvidenceExpression('#save');
    expect(expression).toContain(COLLECT_EVIDENCE_MARKER);
    expect(expression).toContain('"#save"');
    expect(expression.includes('import ')).toBe(false);
    expect(expression.includes('require(')).toBe(false);
  });

  it('collects a descriptor without mutating the inspected page', () => {
    const dom = createFakeDom();
    const descriptor = evaluate(
      buildElementEvidenceExpression('#save'),
      dom.document,
      dom.window
    ) as Record<string, unknown>;

    expect(descriptor['tagName']).toBe('button');
    expect(descriptor['accessibleName']).toBe('Guardar');
    expect(descriptor['classNames']).toEqual(['btn', 'btn-primary']);
    expect(descriptor['computedStyles']).toMatchObject({
      backgroundColor: '#0057b8',
      fontSize: '14px',
      padding: '12px 16px 12px 16px'
    });
    expect(descriptor['geometry']).toEqual({ x: 0, y: 0, width: 120, height: 40 });
    expect(descriptor['viewport']).toEqual({ width: 1280, height: 800 });
    expect(descriptor['disabled']).toBe(false);
    // Read-only guarantee: no DOM mutation API was touched.
    expect(dom.mutations).toEqual([]);
  });

  it('never reads form values or non-allowlisted attributes', () => {
    const dom = createFakeDom({
      tagName: 'input',
      textContent: '',
      attributes: {
        type: 'email',
        name: 'email',
        placeholder: 'Tu email',
        'aria-invalid': 'true',
        value: 'sk-secret-token',
        'data-token': 'opaque-analytics-id'
      },
      labels: [{ textContent: 'Email' }]
    });
    const descriptor = evaluate(
      buildElementEvidenceExpression('#save'),
      dom.document,
      dom.window
    ) as Record<string, unknown>;

    expect(descriptor['inputType']).toBe('email');
    expect(descriptor['accessibleName']).toBe('Email');
    expect(descriptor['labelTexts']).toEqual(['Email']);
    const attributes = descriptor['attributes'] as Record<string, string>;
    expect(attributes['type']).toBe('email');
    expect(attributes['aria-invalid']).toBe('true');
    expect(attributes['value']).toBeUndefined();
    expect(attributes['data-token']).toBeUndefined();
    expect(JSON.stringify(descriptor)).not.toContain('sk-secret-token');
    expect(JSON.stringify(descriptor)).not.toContain('opaque-analytics-id');
  });

  it('returns null when the selector does not match anything', () => {
    const dom = createFakeDom();
    const descriptor = evaluate(
      buildElementEvidenceExpression('#missing'),
      dom.document,
      dom.window
    );
    expect(descriptor).toBeNull();
  });

  it('reads the descriptor from structured content, JSON text or nothing', () => {
    expect(readCollectedDescriptor({ structured: { result: { tagName: 'button' } }, text: '' })).toEqual({
      tagName: 'button'
    });
    expect(readCollectedDescriptor({ structured: {}, text: '{"tagName":"input"}' })).toEqual({
      tagName: 'input'
    });
    expect(readCollectedDescriptor({ structured: { result: 42 }, text: 'evaluated:whatever' })).toBeUndefined();
  });
});
