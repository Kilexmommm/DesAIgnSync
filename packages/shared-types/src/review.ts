import type { JsonValue } from './common.js';
import type { HostErrorBody } from './errors.js';
import type { ElementTarget, EvidenceRef, PageElementEvidence } from './evidence.js';
import type { Finding, FindingStatus } from './finding.js';
import type { MatchResult } from './matching.js';

/**
 * End-to-end element review contracts (DS-018, spec v2.1 §18 and §10).
 *
 * The chain is always:
 *   OBSERVATION -> MATCHING -> VALIDATION -> AI INTERPRETATION -> REPORT
 * and the deterministic sections are authoritative: the LLM interpretation travels in its own
 * field so a report can never present an inference as a measured fact.
 */

export interface ReviewRequest {
  /** Element selected with the picker (DS-012). */
  target: ElementTarget;
  profileId?: string;
  llmProviderId?: string;
  inspectionMcpId?: string;
  designSystemMcpId?: string;
  options?: {
    /** When false the review is deterministic only and no LLM call is made. */
    includeLlm?: boolean;
    /** Screenshots stay off by default (privacy, spec §19). */
    includeScreenshot?: boolean;
    llmTimeoutMs?: number;
    mcpTimeoutMs?: number;
  };
}

export type ReviewLlmStatus = 'ok' | 'skipped' | 'failed';

export interface ReviewLlmSection {
  used: boolean;
  status: ReviewLlmStatus;
  providerId?: string;
  model?: string;
  /** Interpretation is explicitly marked as AI inference, never as measured data. */
  interpretation?: string;
  recommendation?: string;
  uncertainty?: string;
  /** LLM claims that contradicted a deterministic PASS/FAIL and were discarded. */
  rejectedFindings?: number;
  conflicts?: number;
  durationMs?: number;
  error?: HostErrorBody;
}

export interface ReviewVersions {
  hostVersion: string;
  apiVersion: string;
  evidenceSchemaVersion: number;
  matchSchemaVersion: number;
  corePromptVersion: number;
  corePromptFingerprint: string;
  profile?: { id: string; name: string; tier: string; catalogVersion: number };
}

export interface ReviewReproducibility {
  inspectionMcpId?: string;
  designSystemMcpId?: string;
  llmProviderId?: string;
  profileId?: string;
  model?: string;
}

export interface ReviewResult {
  reviewId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  target: ElementTarget;
  evidence: PageElementEvidence;
  /** 0..1 fraction of the evidence model that was actually observed. */
  evidenceCoverage: number;
  match: MatchResult;
  findings: Finding[];
  summary: Record<FindingStatus, number>;
  llm: ReviewLlmSection;
  /** Explainable, non-fatal problems (missing DS reference, skipped screenshot, ...). */
  warnings: string[];
  versions: ReviewVersions;
  reproducibility: ReviewReproducibility;
  evidenceRefs: EvidenceRef[];
}

export interface SaveLlmProviderRequest {
  id?: string;
  name: string;
  baseUrl: string;
  /** Written to the OS credential store; never echoed back. */
  apiKey?: string;
  modelIds?: string[];
  selectedModel?: string;
  visionMode?: 'auto' | 'yes' | 'no';
  headers?: Record<string, string>;
  temperature?: number;
  timeoutMs?: number;
}

export interface LlmProvidersResponse {
  providers: Array<{
    id: string;
    name: string;
    baseUrl: string;
    hasApiKeyRef: boolean;
    modelIds: string[];
    selectedModel?: string;
    visionMode: string;
    isDefault?: boolean;
  }>;
}

export interface TestLlmProviderRequest {
  providerId?: string;
  config?: SaveLlmProviderRequest;
  timeoutMs?: number;
}

export interface TestLlmProviderResponse {
  ok: boolean;
  model?: string;
  latencyMs?: number;
  error?: HostErrorBody;
}

export interface LlmModelsResponse {
  ok: boolean;
  models: string[];
  latencyMs?: number;
  error?: HostErrorBody;
}

export interface ProfilesResponse {
  profiles: Array<{
    id: string;
    name: string;
    tier: string;
    isBuiltIn?: boolean;
    enabledCheckCount: number;
    minConfidence: number;
    maxCandidates: number;
  }>;
}

export type ReviewJsonValue = JsonValue;
