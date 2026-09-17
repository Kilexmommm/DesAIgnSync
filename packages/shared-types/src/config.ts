import type { ToleranceSpec } from './finding.js';
import type { Severity } from './finding.js';

export type McpTransportKind = 'stdio' | 'streamable-http';

/** Functional role of an MCP server inside DesAIgnSync (spec v2.1 §7). */
export type McpServerRole = 'inspection' | 'design-system-reference' | 'generic';

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransportKind;
  /** stdio: executable + arguments. */
  command?: string;
  args?: string[];
  /** Names of secret references; values live in the OS credential store (DS-009). */
  envRefs?: Record<string, string>;
  /** streamable-http endpoint, e.g. http://localhost:6006/mcp */
  url?: string;
  role: McpServerRole;
  enabled: boolean;
  autoStart: boolean;
  timeoutMs?: number;
  description?: string;
  /** Preset this config was created from (`chrome-devtools`, `storybook-ds`, ...). */
  presetId?: string;
}

export type VisionMode = 'auto' | 'yes' | 'no';

export interface LlmProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  /** Reference into the credential store. The key itself never leaves the host. */
  apiKeySecretRef?: string;
  modelIds: string[];
  selectedModel?: string;
  visionMode: VisionMode;
  headers?: Record<string, string>;
  temperature?: number;
  timeoutMs?: number;
  isDefault?: boolean;
}

export const CHECK_IDS = [
  'component.matching',
  'color.text',
  'color.background',
  'color.border',
  'typography.fontFamily',
  'typography.fontSize',
  'typography.fontWeight',
  'typography.lineHeight',
  'spacing.padding',
  'spacing.margin',
  'spacing.gap',
  'shape.borderRadius',
  'shape.border',
  'shape.shadow',
  'dimensions.height',
  'dimensions.width',
  'accessibility.role',
  'accessibility.name',
  'accessibility.label',
  'accessibility.contrast',
  'accessibility.disabledState',
  'accessibility.required'
] as const;

export type CheckId = (typeof CHECK_IDS)[number];

export interface CheckConfig {
  enabled: boolean;
  severity: Severity;
  tolerance: ToleranceSpec;
}

export type ValidationTier = 'simple' | 'advanced' | 'expert';

export interface MatchingWeights {
  semantic: number;
  structure: number;
  attributes: number;
  classes: number;
  css: number;
  geometry: number;
  vision: number;
  docs: number;
  llm: number;
}

export interface MatchingConfig {
  weights: MatchingWeights;
  /** Below this, the product must report `No reliable match` (spec v2.1 §12.2). */
  minConfidence: number;
  maxCandidates: number;
}

export interface PrivacyConfig {
  sendScreenshots: boolean;
  /** When true the review runs without any LLM call. */
  deterministicOnly: boolean;
  piiRedaction: boolean;
  redactionPatterns: string[];
  /** `0` means "do not persist reports at all". */
  historyRetentionDays: number;
  persistPageContent: boolean;
  sensitivePagePatterns: string[];
}

export interface ValidationProfile {
  id: string;
  name: string;
  tier: ValidationTier;
  checks: Partial<Record<CheckId, CheckConfig>>;
  matching: MatchingConfig;
  /** Editable by the user. Combined with rules, never replacing them. */
  advancedInstructions: string;
  privacy?: PrivacyConfig;
  isBuiltIn?: boolean;
}

export const PROFILE_TEMPLATE_IDS = [
  'design-qa',
  'design-system-compliance',
  'accessibility',
  'forms-review',
  'ds-migration',
  'custom'
] as const;

export type ProfileTemplateId = (typeof PROFILE_TEMPLATE_IDS)[number];

export interface ProjectConfig {
  id: string;
  name: string;
  inspectionMcpId?: string;
  designSystemMcpIds: string[];
  activeProfileId?: string;
  llmProviderId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Aggregate persisted by the Local Host in its user config file. */
export interface HostConfigFile {
  version: number;
  port: number;
  allowRemoteOrigins: boolean;
  pinnedExtensionOrigins: string[];
  logLevel: 'silent' | 'error' | 'warn' | 'info' | 'debug';
  /** `auto` prefers the OS credential store; `file` forces the encrypted fallback (CI/headless). */
  secretBackend?: 'auto' | 'os-keychain' | 'file';
  projects: ProjectConfig[];
  mcpServers: McpServerConfig[];
  llmProviders: LlmProviderConfig[];
  profiles: ValidationProfile[];
}