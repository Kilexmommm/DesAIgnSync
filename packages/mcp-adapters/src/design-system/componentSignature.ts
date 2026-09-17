import { normalizeClassNames } from '@desaignsync/core';
import type {
  ComponentSignature,
  DesignSystemCandidate,
  DesignSystemComponent,
  JsonValue,
  StyleReference
} from '@desaignsync/shared-types';

/**
 * Component signature normalization (DS-013, spec v2.1 §11 and §12).
 *
 * Turns a `DesignSystemComponent` returned by ANY Design System MCP into the comparable
 * `ComponentSignature` used by matching. Nothing is invented: `providedFields` records what the
 * MCP actually returned and `derivedFields` records the few values we compute from it.
 */

export const SIGNATURE_SCHEMA_VERSION = 1;

const ROLE_TAG_MAP: Record<string, string> = {
  button: 'button',
  link: 'a',
  textbox: 'input',
  searchbox: 'input',
  checkbox: 'input',
  radio: 'input',
  switch: 'button',
  combobox: 'select',
  listbox: 'select',
  slider: 'input',
  tab: 'button',
  dialog: 'dialog',
  heading: 'h2',
  img: 'img',
  image: 'img',
  table: 'table',
  list: 'ul',
  listitem: 'li',
  form: 'form',
  navigation: 'nav',
  banner: 'header',
  contentinfo: 'footer',
  region: 'section',
  article: 'article',
  status: 'output',
  alert: 'div',
  menuitem: 'li'
};

const KNOWN_TAGS = new Set([
  'button', 'input', 'select', 'textarea', 'a', 'form', 'label', 'table', 'ul', 'li', 'dialog',
  'nav', 'header', 'footer', 'section', 'article', 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'span', 'div', 'p', 'aside', 'output', 'option', 'fieldset'
]);

const INPUT_TYPE_VALUES = new Set([
  'text', 'email', 'password', 'number', 'search', 'tel', 'url', 'date', 'time', 'datetime-local',
  'month', 'week', 'checkbox', 'radio', 'range', 'color', 'file', 'hidden', 'submit', 'reset', 'button'
]);

const STATE_PROP_KEYS = new Set([
  'disabled', 'loading', 'error', 'invalid', 'readonly', 'required', 'selected', 'checked', 'open',
  'active', 'hover', 'focus', 'focused', 'pressed', 'expanded', 'collapsed'
]);

const STYLE_KEYS: readonly (keyof StyleReference)[] = [
  'color', 'backgroundColor', 'borderColor', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight',
  'padding', 'gap', 'width', 'height', 'minHeight', 'borderRadius', 'borderWidth', 'boxShadow',
  'opacity'
];

export const EXPECTED_SIGNATURE_FIELDS: readonly string[] = [
  'component',
  'variant',
  'semanticRole',
  'expectedTags',
  'props',
  'styles',
  'states',
  'documentation',
  'visualReferenceRef'
];

export interface SignatureOptions {
  sourceMcp: string;
  retrievedAt?: string;
  schemaVersion?: number;
}

const mapStyles = (styles: StyleReference | undefined): StyleReference | undefined => {
  if (!styles) return undefined;
  const mapped: StyleReference = {};
  for (const key of STYLE_KEYS) {
    const value = styles[key];
    if (value !== undefined) (mapped[key] as unknown) = value;
  }
  return Object.keys(mapped).length === 0 ? undefined : mapped;
};

const asProps = (value: Record<string, JsonValue> | undefined): Record<string, JsonValue> | undefined =>
  value === undefined || Object.keys(value).length === 0 ? undefined : value;

const deriveExpectedInputTypes = (props: Record<string, JsonValue> | undefined): string[] | undefined => {
  if (!props) return undefined;
  const raw = props['type'] ?? props['inputType'];
  const values =
    typeof raw === 'string'
      ? [raw]
      : Array.isArray(raw)
        ? raw.filter((entry): entry is string => typeof entry === 'string')
        : [];
  const known = values
    .map((entry) => entry.toLowerCase().trim())
    .filter((entry) => INPUT_TYPE_VALUES.has(entry));
  return known.length === 0 ? undefined : [...new Set(known)];
};

const deriveStructure = (props: Record<string, JsonValue> | undefined): ComponentSignature['structure'] => {
  if (!props) return undefined;
  const keys = Object.keys(props).map((key) => key.toLowerCase());
  const structure: NonNullable<ComponentSignature['structure']> = {};
  if (keys.includes('label') || keys.includes('labeltext')) structure.hasLabel = true;
  if (keys.some((key) => key.includes('icon'))) structure.hasIcon = true;
  return Object.keys(structure).length === 0 ? undefined : structure;
};

const deriveStates = (props: Record<string, JsonValue> | undefined): string[] | undefined => {
  if (!props) return undefined;
  const states = Object.keys(props)
    .map((key) => key.toLowerCase())
    .filter((key) => STATE_PROP_KEYS.has(key));
  return states.length === 0 ? undefined : [...new Set(states)];
};

/** Normalizes one Design System component into a comparable signature. */
export function toComponentSignature(
  component: DesignSystemComponent,
  options: SignatureOptions
): ComponentSignature {
  const providedFields: string[] = ['id', 'componentName'];
  const derivedFields: string[] = [];

  if (component.variantName !== undefined) providedFields.push('variantName');
  if (component.description !== undefined) providedFields.push('description');
  if (component.roles !== undefined && component.roles.length > 0) providedFields.push('roles');
  if (component.props !== undefined) providedFields.push('props');
  if (component.usageGuidelines !== undefined) providedFields.push('usageGuidelines');
  if (component.referenceStyles !== undefined) providedFields.push('referenceStyles');
  if (component.storyOrPreviewRef !== undefined) providedFields.push('storyOrPreviewRef');
  if (component.screenshotRef !== undefined) providedFields.push('screenshotRef');

  const props = asProps(component.props);
  const classKeywords = normalizeClassNames(
    [component.componentName, component.variantName ? `${component.componentName} ${component.variantName}` : '']
      .filter((entry) => entry !== '')
  ).semanticTokens;

  const signature: ComponentSignature = {
    schemaVersion: options.schemaVersion ?? SIGNATURE_SCHEMA_VERSION,
    id: component.id,
    component: component.componentName,
    sourceMcp: options.sourceMcp,
    providedFields,
    kind: 'observed',
    retrievedAt: options.retrievedAt ?? new Date().toISOString(),
    ...(component.variantName !== undefined ? { variant: component.variantName } : {})
  };

  const semanticRole = component.roles?.[0];
  if (semanticRole !== undefined) signature.semanticRole = semanticRole;

  const roleTag = semanticRole !== undefined ? ROLE_TAG_MAP[semanticRole.toLowerCase()] : undefined;
  const tagKeywords = classKeywords.filter((keyword) => KNOWN_TAGS.has(keyword));
  const expectedTags = [...new Set([roleTag, ...tagKeywords].filter((tag): tag is string => tag !== undefined))];
  if (expectedTags.length > 0) {
    signature.expectedTags = expectedTags;
    derivedFields.push('expectedTags');
  }

  const expectedInputTypes = deriveExpectedInputTypes(props);
  if (expectedInputTypes !== undefined) {
    signature.expectedInputTypes = expectedInputTypes;
    derivedFields.push('expectedInputTypes');
  }

  const structure = deriveStructure(props);
  if (structure !== undefined) signature.structure = structure;

  const states = deriveStates(props);
  if (states !== undefined) signature.states = states;

  if (props !== undefined) signature.props = props;

  const styles = mapStyles(component.referenceStyles);
  if (styles !== undefined) signature.styles = styles;

  const documentation = component.usageGuidelines ?? component.description;
  if (documentation !== undefined) signature.documentation = documentation;
  if (classKeywords.length > 0) signature.classKeywords = classKeywords;

  const visualReferenceRef = component.screenshotRef ?? component.storyOrPreviewRef;
  if (visualReferenceRef !== undefined) signature.visualReferenceRef = visualReferenceRef;

  if (derivedFields.length > 0) signature.derivedFields = derivedFields;

  return signature;
}

export const toComponentSignatures = (
  components: readonly DesignSystemComponent[],
  options: SignatureOptions
): ComponentSignature[] => components.map((component) => toComponentSignature(component, options));

/** Share of matching-relevant fields actually available for this signature. */
export function signatureCoverage(signature: ComponentSignature): number {
  const present = EXPECTED_SIGNATURE_FIELDS.filter(
    (field) => (signature as unknown as Record<string, unknown>)[field] !== undefined
  );
  return present.length / EXPECTED_SIGNATURE_FIELDS.length;
}

/** Text used to query `search_components` on remote Design System MCP servers. */
export function signatureSearchText(signature: ComponentSignature): string {
  return [
    signature.component,
    signature.variant ?? '',
    signature.semanticRole ?? '',
    ...(signature.classKeywords ?? []),
    signature.documentation ?? ''
  ]
    .filter((entry) => entry !== '')
    .join(' ')
    .slice(0, 400);
}

export function candidateFromSignature(signature: ComponentSignature): DesignSystemCandidate {
  return {
    componentId: signature.id,
    componentName: signature.component,
    sourceMcp: signature.sourceMcp,
    signatureId: signature.id,
    ...(signature.variant !== undefined ? { variantName: signature.variant } : {}),
    ...(signature.documentation !== undefined ? { summary: signature.documentation } : {})
  };
}
