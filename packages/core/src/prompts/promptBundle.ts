import type { Finding, FindingStatus, JsonObject, JsonValue } from '@desaignsync/shared-types';

import {
  CORE_PROMPT_FINGERPRINT,
  CORE_PROMPT_VERSION,
  CORE_SYSTEM_PROMPT,
  resolveAdvancedInstructions,
  type AdvancedInstructionsSource
} from './corePrompt.js';

/**
 * Prompt assembly and untrusted-content handling (DS-016, spec §14).
 *
 * Order is fixed: Core Prompt -> structured profile -> advanced instructions -> Design System
 * evidence -> page evidence -> deterministic results -> task. Page and MCP content is wrapped as
 * untrusted evidence, and instruction-like text found there is neutralized instead of obeyed.
 */

export const PROMPT_BUNDLE_VERSION = 1;
export const UNTRUSTED_OPEN = '<<<UNTRUSTED_EVIDENCE';
export const UNTRUSTED_CLOSE = 'UNTRUSTED_EVIDENCE>>>';

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
/** Neutralizes role-play smuggling even when the text arrives inside a list item or a paragraph. */
const ROLE_SMUGGLING = /(^|[\s>*-])(system|assistant|user|tool|developer)\s*:/gim;

const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /\b(ignore|disregard|forget)\b[^\n]{0,40}\b(previous|prior|above|all)\b[^\n]{0,20}\binstructions?\b/gi,
  /\b(you are now|from now on|act as the system|new instructions?|system prompt)\b/gi,
  /\b(mark|treat|report)\b[^\n]{0,30}\b(this page|the page|it)\b[^\n]{0,20}\b(as )?(compliant|passed|ok|no issues)\b/gi
];

/** Neutralizes instruction-like content so page text can only ever be read as evidence. */
export const sanitizeUntrustedText = (value: string): string => {
  let sanitized = value.replace(/\r\n/g, '\n').replace(CONTROL_CHARS, ' ');
  sanitized = sanitized.replace(ROLE_SMUGGLING, '$1[page text] $2:');
  for (const pattern of INSTRUCTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[neutralized instruction]');
  }
  return sanitized.replace(/\n{3,}/g, '\n\n').trim();
};

export const wrapUntrustedBlock = (label: string, content: string): string =>
  `${UNTRUSTED_OPEN}: ${label}\n${sanitizeUntrustedText(content)}\n${UNTRUSTED_CLOSE}`;

/** JSON schema the model must satisfy; validated locally before findings are merged (DS-016 AC). */
export const REVIEW_RESPONSE_SCHEMA: JsonObject = {
  type: 'object',
  required: ['findings'],
  properties: {
    summary: { type: 'string' },
    recommendation: { type: 'string' },
    uncertainty: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['ruleId', 'status', 'explanation'],
        properties: {
          ruleId: { type: 'string' },
          status: { enum: ['PASS', 'FAIL', 'REVIEW', 'NOT_EVALUATED'] },
          observed: {},
          expected: {},
          difference: {},
          tolerance: {},
          evidenceRefs: { type: 'array', items: { type: 'string' } },
          matchConfidence: { type: 'number', minimum: 0, maximum: 1 },
          explanation: { type: 'string' }
        }
      }
    }
  }
};

export interface LlmReviewFinding {
  ruleId: string;
  status: FindingStatus;
  explanation: string;
  observed?: JsonValue;
  expected?: JsonValue;
  difference?: JsonValue;
  tolerance?: JsonValue;
  evidenceRefs?: string[];
  matchConfidence?: number;
}

export interface LlmReviewResponse {
  findings: LlmReviewFinding[];
  summary?: string;
  recommendation?: string;
  uncertainty?: string;
}

export interface LlmReviewValidation {
  ok: boolean;
  issues: string[];
  value?: LlmReviewResponse;
}

const FINDING_STATUS_VALUES: readonly FindingStatus[] = ['PASS', 'FAIL', 'REVIEW', 'NOT_EVALUATED'];

export const validateLlmReviewResponse = (payload: unknown): LlmReviewValidation => {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, issues: ['response is not a JSON object'] };
  }

  const record = payload as Record<string, unknown>;
  const issues: string[] = [];
  const rawFindings = record['findings'];
  const findings: LlmReviewFinding[] = [];

  if (!Array.isArray(rawFindings)) {
    return { ok: false, issues: ['findings must be an array'] };
  }

  rawFindings.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      issues.push(`findings[${index}] is not an object`);
      return;
    }
    const candidate = entry as Record<string, unknown>;
    const ruleId = candidate['ruleId'];
    const status = candidate['status'];
    const explanation = candidate['explanation'];
    const matchConfidence = candidate['matchConfidence'];

    if (typeof ruleId !== 'string' || ruleId.trim() === '') {
      issues.push(`findings[${index}].ruleId is required`);
    }
    if (typeof status !== 'string' || !FINDING_STATUS_VALUES.includes(status as FindingStatus)) {
      issues.push(`findings[${index}].status must be PASS, FAIL, REVIEW or NOT_EVALUATED`);
    }
    if (typeof explanation !== 'string' || explanation.trim() === '') {
      issues.push(`findings[${index}].explanation is required`);
    }
    if (
      matchConfidence !== undefined &&
      (typeof matchConfidence !== 'number' || matchConfidence < 0 || matchConfidence > 1)
    ) {
      issues.push(`findings[${index}].matchConfidence must be between 0 and 1`);
    }

    findings.push({
      ruleId: typeof ruleId === 'string' ? ruleId : '',
      status: (typeof status === 'string' ? status : 'REVIEW') as FindingStatus,
      explanation: typeof explanation === 'string' ? explanation : '',
      ...(candidate['observed'] !== undefined ? { observed: candidate['observed'] as JsonValue } : {}),
      ...(candidate['expected'] !== undefined ? { expected: candidate['expected'] as JsonValue } : {}),
      ...(candidate['difference'] !== undefined ? { difference: candidate['difference'] as JsonValue } : {}),
      ...(candidate['tolerance'] !== undefined ? { tolerance: candidate['tolerance'] as JsonValue } : {}),
      ...(Array.isArray(candidate['evidenceRefs'])
        ? { evidenceRefs: candidate['evidenceRefs'].filter((ref): ref is string => typeof ref === 'string') }
        : {}),
      ...(typeof matchConfidence === 'number' ? { matchConfidence } : {})
    });
  });

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    issues: [],
    value: {
      findings,
      ...(typeof record['summary'] === 'string' ? { summary: record['summary'] } : {}),
      ...(typeof record['recommendation'] === 'string' ? { recommendation: record['recommendation'] } : {}),
      ...(typeof record['uncertainty'] === 'string' ? { uncertainty: record['uncertainty'] } : {})
    }
  };
};

export interface ReconciliationConflict {
  ruleId: string;
  deterministicStatus: FindingStatus;
  llmStatus: FindingStatus;
}

export interface ReconciliationResult {
  /** Deterministic findings, unchanged and authoritative. */
  findings: Finding[];
  /** LLM claims that tried to change a measured status; kept only for auditing. */
  rejectedLlmFindings: LlmReviewFinding[];
  conflicts: ReconciliationConflict[];
}

/**
 * Rules Engine results are final. The LLM may add explanation, but any attempt to flip a measured
 * PASS/FAIL is rejected and recorded as a conflict (spec §15, DS-018 AC).
 */
export const reconcileFindings = (
  deterministic: readonly Finding[],
  llmFindings: readonly LlmReviewFinding[]
): ReconciliationResult => {
  const measured = new Map(deterministic.map((finding) => [finding.ruleId, finding]));
  const rejectedLlmFindings: LlmReviewFinding[] = [];
  const conflicts: ReconciliationConflict[] = [];

  for (const entry of llmFindings) {
    const reference = measured.get(entry.ruleId);
    if (!reference) continue;
    if (reference.status !== 'NOT_EVALUATED' && reference.status !== entry.status) {
      rejectedLlmFindings.push(entry);
      conflicts.push({
        ruleId: entry.ruleId,
        deterministicStatus: reference.status,
        llmStatus: entry.status
      });
    }
  }

  return { findings: [...deterministic], rejectedLlmFindings, conflicts };
};

export type PromptSectionId =
  | 'core'
  | 'profile'
  | 'advanced'
  | 'design-system'
  | 'evidence'
  | 'deterministic'
  | 'task';

export interface PromptSection {
  id: PromptSectionId;
  title: string;
  content: string;
  /** True when the content comes from a page or an MCP server (data, never instructions). */
  untrusted: boolean;
}

export interface PromptBundleInput {
  task: string;
  /** Structured profile summary (checks, tolerances, severities) built independently of free text. */
  profileInstructions?: string;
  /** User-editable advanced instructions. */
  advancedInstructions?: string;
  /** Default advanced instructions shipped by the selected profile. */
  profileAdvancedInstructions?: string;
  designSystemReferences?: string[];
  evidenceSummaries?: string[];
  deterministicFindings?: string[];
  matchSummary?: string;
}

export interface PromptBundle {
  version: number;
  corePromptVersion: number;
  corePromptFingerprint: string;
  advancedInstructionsSource: AdvancedInstructionsSource;
  advancedInstructionsIssues: string[];
  sections: PromptSection[];
  /** Core Prompt, sent as the system message. */
  system: string;
  /** Everything else, in the documented order. */
  user: string;
  responseSchema: JsonObject;
}

const renderList = (items: readonly string[] | undefined, extra?: string): string => {
  const lines = [...(items ?? [])];
  if (extra !== undefined && extra.trim() !== '') lines.push(extra.trim());
  return lines.length > 0 ? lines.map((line) => `- ${line}`).join('\n') : '(none provided)';
};

const sectionToText = (section: PromptSection): string => {
  const body = section.untrusted ? wrapUntrustedBlock(section.title, section.content) : section.content;
  return `## ${section.title}\n${body}`;
};

/** Builds the versioned prompt bundle. The core section always comes from the code constant. */
export function buildPromptBundle(input: PromptBundleInput): PromptBundle {
  const advanced = resolveAdvancedInstructions({
    ...(input.advancedInstructions !== undefined ? { custom: input.advancedInstructions } : {}),
    ...(input.profileAdvancedInstructions !== undefined
      ? { profileDefault: input.profileAdvancedInstructions }
      : {})
  });

  const sections: PromptSection[] = [
    {
      id: 'core',
      title: 'Core System Prompt (protected, read-only)',
      content: CORE_SYSTEM_PROMPT,
      untrusted: false
    },
    {
      id: 'profile',
      title: 'Structured validation profile',
      content: input.profileInstructions?.trim() ?? '(product defaults)',
      untrusted: false
    },
    {
      id: 'advanced',
      title: 'Advanced AI instructions (user-editable)',
      content: advanced.text,
      untrusted: false
    },
    {
      id: 'design-system',
      title: 'Design System references (MCP evidence)',
      content: sanitizeUntrustedText(renderList(input.designSystemReferences)),
      untrusted: true
    },
    {
      id: 'evidence',
      title: 'Observed page evidence',
      content: sanitizeUntrustedText(renderList(input.evidenceSummaries)),
      untrusted: true
    },
    {
      id: 'deterministic',
      title: 'Deterministic check results (authoritative)',
      content: renderList(input.deterministicFindings, input.matchSummary),
      untrusted: false
    },
    {
      id: 'task',
      title: 'Task request',
      content: input.task.trim(),
      untrusted: false
    }
  ];

  return {
    version: PROMPT_BUNDLE_VERSION,
    corePromptVersion: CORE_PROMPT_VERSION,
    corePromptFingerprint: CORE_PROMPT_FINGERPRINT,
    advancedInstructionsSource: advanced.source,
    advancedInstructionsIssues: advanced.validation.issues,
    sections,
    system: sections
      .filter((section) => section.id === 'core')
      .map((section) => section.content)
      .join('\n\n'),
    user: sections
      .filter((section) => section.id !== 'core')
      .map((section) => sectionToText(section))
      .join('\n\n'),
    responseSchema: REVIEW_RESPONSE_SCHEMA
  };
}