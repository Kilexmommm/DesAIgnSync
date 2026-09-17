import type { ComponentSignature } from '@desaignsync/shared-types';

import type { RuleReference } from '../rules/rulesEngine.js';

/**
 * Projects a Design System signature onto the Rules Engine reference (DS-018).
 * Only fields the MCP actually provided are projected: nothing is inferred, defaulted or invented.
 */
export const signatureToRuleReference = (signature: ComponentSignature): RuleReference => {
  const reference: RuleReference = {};
  if (signature.styles) Object.assign(reference, signature.styles);
  if (signature.semanticRole !== undefined) reference.role = signature.semanticRole;
  if (signature.expectedTags !== undefined && signature.expectedTags.length > 0) {
    reference.tags = [...signature.expectedTags];
  }
  if (signature.states !== undefined && signature.states.length > 0) {
    reference.states = [...signature.states];
  }
  const accessibleName = readStringProp(signature.props, ['accessibilityLabel', 'ariaLabel', 'label']);
  if (accessibleName !== undefined) reference.accessibleName = accessibleName;
  return reference;
};

/** Field names present in the reference; used for warnings and Expert debugging. */
export const describeRuleReference = (reference: RuleReference | undefined): string[] =>
  reference === undefined ? [] : Object.keys(reference).sort();

/**
 * Reads a directly provided string prop. Objective definitions such as
 * `{ label: { type: 'string' } }` are ignored on purpose: only real values count as reference.
 */
const readStringProp = (
  props: Record<string, unknown> | undefined,
  keys: readonly string[]
): string | undefined => {
  if (props === undefined) return undefined;
  for (const key of keys) {
    const value = props[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return undefined;
};
