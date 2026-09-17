import type {
  ComponentSignature,
  Finding,
  FindingStatus,
  HostErrorBody,
  LlmMatchHints,
  MatchResult,
  PageElementEvidence,
  ValidationProfile
} from '@desaignsync/shared-types';

import { evidenceCoverage } from '../evidence/normalizeElementEvidence.js';
import { matchElement } from '../matching/matchingEngine.js';
import { evaluateRules, summarizeFindings, type RuleReference } from '../rules/rulesEngine.js';
import { signatureToRuleReference } from './ruleReference.js';

/**
 * Deterministic review assembly (DS-018): matching + rules over already-collected evidence.
 *
 * This function performs no I/O on purpose: the Local Host orchestrator collects evidence from
 * Chrome MCP and references from the Design System MCP, then delegates here. That keeps the
 * "OBSERVATION -> MATCHING -> VALIDATION" chain fully unit-testable without mocks.
 */

export interface ReviewLlmOutcome {
  status: 'ok' | 'skipped' | 'failed';
  providerId?: string;
  model?: string;
  interpretation?: string;
  recommendation?: string;
  uncertainty?: string;
  rejectedFindings: number;
  conflicts: number;
  durationMs?: number;
  error?: HostErrorBody;
}

export interface ReviewAssemblyInput {
  evidence: PageElementEvidence;
  signatures: readonly ComponentSignature[];
  profile: ValidationProfile;
  /** Optional LLM ranking hint. Never the only signal (DS-014 caps its weight). */
  matchHints?: LlmMatchHints;
  evidenceRefs?: string[];
  sourceMcpRefs?: string[];
}

export interface ReviewAssembly {
  match: MatchResult;
  reference?: RuleReference;
  findings: Finding[];
  summary: Record<FindingStatus, number>;
  evidenceCoverage: number;
  warnings: string[];
}

export const assembleReview = (input: ReviewAssemblyInput): ReviewAssembly => {
  const warnings: string[] = [];

  const match = matchElement(input.evidence, input.signatures, {
    config: input.profile.matching,
    ...(input.matchHints ? { llmHints: input.matchHints } : {}),
    ...(input.evidenceRefs ? { evidenceRefs: input.evidenceRefs } : {})
  });

  const selectedSignature =
    match.selected?.signatureId !== undefined
      ? input.signatures.find((signature) => signature.id === match.selected?.signatureId)
      : undefined;

  let reference: RuleReference | undefined;
  if (selectedSignature !== undefined) {
    reference = signatureToRuleReference(selectedSignature);
    if (Object.keys(reference).length === 0) {
      warnings.push(
        'The matched Design System component provides no comparable reference values; component-specific checks stay NOT_EVALUATED.'
      );
    }
  } else {
    warnings.push('No reliable component match: only reference-independent checks were evaluated.');
  }

  const findings = evaluateRules(
    {
      evidence: input.evidence,
      ...(reference !== undefined ? { reference } : {}),
      ...(match.confidence !== undefined ? { matchConfidence: match.confidence } : {}),
      ...(input.evidenceRefs ? { evidenceRefs: input.evidenceRefs } : {}),
      ...(input.sourceMcpRefs ? { sourceMcpRefs: input.sourceMcpRefs } : {})
    },
    { checks: input.profile.checks }
  );

  return {
    match,
    ...(reference !== undefined ? { reference } : {}),
    findings,
    summary: summarizeFindings(findings),
    evidenceCoverage: evidenceCoverage(input.evidence).ratio,
    warnings
  };
};
