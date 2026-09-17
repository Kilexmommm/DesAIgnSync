/**
 * @desaignsync/core — deterministic engines.
 *
 * Ownership by wave (spec v2.1 §24, backlog DS-001):
 *   - src/evidence   ElementEvidence normalization                  (DS-010, wave 3)
 *   - src/matching   candidate ranking + confidence                 (DS-014, wave 4)
 *   - src/rules      deterministic PASS/FAIL/REVIEW/NOT_EVALUATED   (DS-015, wave 4)
 *   - src/reporting  checklist + export                             (DS-020, wave 5/6)
 *
 * No engine is implemented yet. This module re-exports the contracts the engines will
 * build on, which also proves `packages/shared-types` is consumable from Core (DS-001 AC).
 */

export type {
  Box,
  Confidence,
  ComputedStyleEvidence,
  ComponentSignature,
  DesignSystemCandidate,
  DsCapabilityReport,
  DsLogicalOperation,
  EvidenceKind,
  EvidenceRef,
  Finding,
  FindingStatus,
  JsonObject,
  JsonValue,
  MatchingConfig,
  MatchingWeights,
  PageElementEvidence,
  RuleCategory,
  Severity,
  StyleReference,
  ToleranceSpec
} from '@desaignsync/shared-types';

export {
  CHECK_IDS,
  DS_LOGICAL_OPERATIONS,
  EVIDENCE_SCHEMA_VERSION,
  FINDING_STATUSES,
  SHARED_TYPES_VERSION
} from '@desaignsync/shared-types';