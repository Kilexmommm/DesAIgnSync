import { randomUUID } from 'node:crypto';

import {
  DesaignSyncHostError,
  EVIDENCE_SCHEMA_VERSION,
  HOST_API_VERSION,
  MATCH_SCHEMA_VERSION,
  type ComponentSignature,
  type EvidenceRef,
  type Finding,
  type PageElementEvidence,
  type ReviewLlmSection,
  type ReviewRequest,
  type ReviewResult,
  type ValidationProfile
} from '@desaignsync/shared-types';
import {
  CORE_PROMPT_FINGERPRINT,
  CORE_PROMPT_VERSION,
  assembleReview,
  buildPromptBundle,
  explainMatchResult,
  normalizeElementEvidence,
  profileRef,
  reconcileFindings,
  summarizeEvidence,
  summarizeProfile,
  validateLlmReviewResponse,
  type ReviewAssembly
} from '@desaignsync/core';
import {
  ChromeMCPAdapter,
  DesignSystemMCPAdapter,
  buildElementEvidenceExpression,
  createManagerGateway,
  readCollectedDescriptor,
  toComponentSignature
} from '@desaignsync/mcp-adapters';

import { HOST_VERSION } from '../config/hostConfig.js';
import type { Logger } from '../logging/logger.js';
import { toHostError, type McpClientManager } from '../mcp/McpClientManager.js';
import type { LlmProviderRegistry } from '../llm/providerRegistry.js';
import type { ProfileRegistry } from './profileRegistry.js';

/**
 * Review orchestrator (DS-018): the vertical slice.
 *
 *   select element -> Chrome MCP -> evidence -> Design System MCP -> signatures
 *   -> matching -> deterministic rules -> optional LLM interpretation -> result
 *
 * Guarantees enforced here:
 *  - a Design System MCP failure produces an explainable `no-reliable-match` review, not a crash;
 *  - an LLM failure keeps the deterministic report intact (spec §9.1 / DS-018 AC);
 *  - the LLM interpretation is a separate field and can never rewrite a measured PASS/FAIL.
 */
export interface ReviewOrchestratorOptions {
  mcp: McpClientManager;
  providers: LlmProviderRegistry;
  profiles: ProfileRegistry;
  logger: Logger;
  hostVersion?: string;
}

export class ReviewOrchestrator {
  readonly #options: ReviewOrchestratorOptions;

  constructor(options: ReviewOrchestratorOptions) {
    this.#options = options;
  }

  async review(request: ReviewRequest): Promise<ReviewResult> {
    const startedAtMs = Date.now();
    const warnings: string[] = [];
    const profile = this.#options.profiles.getOrDefault(request.profileId);
    const inspectionMcpId = this.#resolveInspectionServer(request.inspectionMcpId);
    const designSystemMcpId =
      request.designSystemMcpId ??
      this.#options.mcp.findReadyServerIdsByRole('design-system-reference')[0];

    const chrome = new ChromeMCPAdapter(createManagerGateway(this.#options.mcp, inspectionMcpId));
    const evidence = await this.#collectEvidence(chrome, request, warnings);

    const signatures = await this.#collectSignatures(designSystemMcpId, evidence, warnings);

    const evidenceRefs: EvidenceRef[] = [
      {
        id: 'evidence-element',
        kind: 'element',
        label: 'Element evidence (DOM/ARIA/CSS/geometry)',
        source: `mcp:${inspectionMcpId}`
      },
      ...(designSystemMcpId !== undefined
        ? [
            {
              id: 'evidence-design-system',
              kind: 'design-system' as const,
              label: 'Design System reference (MCP)',
              source: `mcp:${designSystemMcpId}`
            }
          ]
        : []),
      {
        id: 'evidence-rules',
        kind: 'rule',
        label: 'Deterministic rules engine',
        source: 'core:rules'
      }
    ];

    const assembly = assembleReview({
      evidence,
      signatures,
      profile,
      evidenceRefs: evidenceRefs.map((ref) => ref.id),
      ...(designSystemMcpId !== undefined ? { sourceMcpRefs: [designSystemMcpId] } : {})
    });
    warnings.push(...assembly.warnings);

    const llm = await this.#interpret(request, profile, evidence, assembly, warnings);

    const finishedAtMs = Date.now();
    return {
      reviewId: `review-${randomUUID().slice(0, 8)}`,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: finishedAtMs - startedAtMs,
      target: request.target,
      evidence,
      evidenceCoverage: assembly.evidenceCoverage,
      match: assembly.match,
      findings: assembly.findings,
      summary: assembly.summary,
      llm,
      warnings,
      versions: {
        hostVersion: this.#options.hostVersion ?? HOST_VERSION,
        apiVersion: HOST_API_VERSION,
        evidenceSchemaVersion: EVIDENCE_SCHEMA_VERSION,
        matchSchemaVersion: MATCH_SCHEMA_VERSION,
        corePromptVersion: CORE_PROMPT_VERSION,
        corePromptFingerprint: CORE_PROMPT_FINGERPRINT,
        profile: profileRef(profile)
      },
      reproducibility: {
        inspectionMcpId,
        ...(designSystemMcpId !== undefined ? { designSystemMcpId } : {}),
        ...(llm.providerId !== undefined ? { llmProviderId: llm.providerId } : {}),
        profileId: profile.id,
        ...(llm.model !== undefined ? { model: llm.model } : {})
      },
      evidenceRefs
    };
  }

  #resolveInspectionServer(explicitId?: string): string {
    const serverId =
      explicitId ?? this.#options.mcp.findReadyServerIdsByRole('inspection')[0];
    if (serverId === undefined) {
      throw new DesaignSyncHostError(
        'CHROME_MCP_UNAVAILABLE',
        'No Chrome DevTools MCP server is connected; connect one before reviewing an element.'
      );
    }
    return serverId;
  }

  async #collectEvidence(
    chrome: ChromeMCPAdapter,
    request: ReviewRequest,
    warnings: string[]
  ): Promise<PageElementEvidence> {
    const { target } = request;
    const pageId = target.pageId ?? target.tabId;
    if (pageId !== undefined) {
      try {
        await chrome.selectPage(String(pageId), request.options?.mcpTimeoutMs);
      } catch (error) {
        warnings.push(`The active page could not be selected explicitly: ${messageOf(error)}`);
      }
    }

    const evaluation = await chrome.evaluateScript(
      buildElementEvidenceExpression(target.selector),
      {},
      request.options?.mcpTimeoutMs
    );
    const descriptor = readCollectedDescriptor(evaluation);
    if (descriptor === undefined) {
      throw new DesaignSyncHostError(
        'INSPECTION_FAILED',
        `The inspected page no longer contains the selected element (${target.selector}).`,
        { details: { selector: target.selector } }
      );
    }

    const evidence = normalizeElementEvidence({
      pageId: target.pageId ?? 0,
      ...(target.uid !== undefined ? { uid: target.uid } : {}),
      ...(target.url !== undefined ? { url: target.url } : {}),
      ...descriptor,
      source: { inspectionMcpId: chrome.serverId, toolName: evaluation.toolName }
    });

    try {
      const snapshot = await chrome.takeSnapshot(
        pageId !== undefined ? String(pageId) : undefined,
        request.options?.mcpTimeoutMs
      );
      if (snapshot.text !== '') evidence.snapshotExcerpt = snapshot.text.slice(0, 400);
    } catch (error) {
      warnings.push(`Accessibility snapshot not available: ${messageOf(error)}`);
    }

    if (request.options?.includeScreenshot === true) {
      try {
        const screenshot = await chrome.takeScreenshot(
          target.uid !== undefined ? { uid: target.uid } : {},
          request.options?.mcpTimeoutMs
        );
        if (screenshot.dataBase64 !== undefined) {
          evidence.screenshotRef = `screenshot:${screenshot.mimeType}`;
        } else {
          warnings.push('The screenshot tool returned no image data; visual evidence is unavailable.');
        }
      } catch (error) {
        warnings.push(`Screenshot not captured: ${messageOf(error)}`);
      }
    }

    return evidence;
  }

  async #collectSignatures(
    serverId: string | undefined,
    evidence: PageElementEvidence,
    warnings: string[]
  ): Promise<ComponentSignature[]> {
    if (serverId === undefined) {
      warnings.push(
        'No Design System MCP server is connected; matching and component-specific checks were skipped.'
      );
      return [];
    }

    try {
      const adapter = new DesignSystemMCPAdapter(createManagerGateway(this.#options.mcp, serverId));
      let candidates = await adapter.searchComponents(buildSearchQuery(evidence));
      if (candidates.length === 0) {
        candidates = await adapter.listComponents();
        if (candidates.length > 0) {
          warnings.push(
            'The Design System search returned no candidates; the component inventory was used instead.'
          );
        }
      }
      if (candidates.length === 0) {
        warnings.push(`Design System MCP "${serverId}" returned no components to compare against.`);
        return [];
      }

      const signatures: ComponentSignature[] = [];
      for (const candidate of candidates.slice(0, MAX_SIGNATURE_CANDIDATES)) {
        const signature = await this.#describeCandidate(adapter, candidate.id, warnings);
        if (signature !== undefined) signatures.push(signature);
      }
      return signatures;
    } catch (error) {
      const body = toHostError(error, serverId);
      warnings.push(`Design System MCP error (${body.code}): ${body.message}`);
      return [];
    }
  }

  async #describeCandidate(
    adapter: DesignSystemMCPAdapter,
    componentId: string,
    warnings: string[]
  ): Promise<ComponentSignature | undefined> {
    try {
      const component = await adapter.getComponent(componentId);
      let reference = component;
      try {
        reference = await adapter.getVariantReference(componentId);
      } catch {
        // Servers without variant references keep the component-level reference.
      }
      const signature = toComponentSignature(reference, { sourceMcp: adapter.serverId });
      if (signature.documentation === undefined) {
        try {
          const guidelines = await adapter.getUsageGuidelines(componentId);
          if (guidelines !== undefined && guidelines !== '') signature.documentation = guidelines;
        } catch {
          // Guidelines are optional evidence.
        }
      }
      return signature;
    } catch (error) {
      warnings.push(`Design System component "${componentId}" could not be read: ${messageOf(error)}`);
      return undefined;
    }
  }

  async #interpret(
    request: ReviewRequest,
    profile: ValidationProfile,
    evidence: PageElementEvidence,
    assembly: ReviewAssembly,
    warnings: string[]
  ): Promise<ReviewLlmSection> {
    const deterministicOnly = profile.privacy?.deterministicOnly === true;
    const includeLlm = request.options?.includeLlm ?? !deterministicOnly;
    if (!includeLlm) {
      return { used: false, status: 'skipped', rejectedFindings: 0, conflicts: 0 };
    }
    if (this.#options.providers.list().length === 0) {
      warnings.push('No LLM provider is configured; only the deterministic results are shown.');
      return { used: false, status: 'skipped', rejectedFindings: 0, conflicts: 0 };
    }

    const startedAtMs = Date.now();
    try {
      const adapter = this.#options.providers.adapter(request.llmProviderId);
      const bundle = buildPromptBundle({
        task: 'Review the observed element against the Design System reference and return the structured compliance result.',
        profileInstructions: describeProfileForPrompt(profile),
        ...(profile.advancedInstructions.trim() !== ''
          ? { advancedInstructions: profile.advancedInstructions }
          : {}),
        designSystemReferences: [
          JSON.stringify(assembly.reference ?? { note: 'no reliable component match' })
        ],
        evidenceSummaries: [JSON.stringify(summarizeEvidence(evidence))],
        deterministicFindings: formatFindings(assembly.findings),
        matchSummary: explainMatchResult(assembly.match).join('\n')
      });

      const completion = await adapter.complete(
        {
          system: bundle.system,
          messages: [{ role: 'user', content: bundle.user }],
          jsonMode: true,
          maxTokens: 1200
        },
        request.options?.llmTimeoutMs
      );

      const validation = validateLlmReviewResponse(parseJsonText(completion.text));
      if (!validation.ok || validation.value === undefined) {
        return {
          used: true,
          status: 'failed',
          providerId: adapter.config.id,
          model: completion.model,
          rejectedFindings: 0,
          conflicts: 0,
          durationMs: Date.now() - startedAtMs,
          error: {
            code: 'LLM_BAD_RESPONSE',
            message: `The model did not return the required schema: ${validation.issues.slice(0, 3).join('; ')}`,
            retryable: false,
            correlationId: `llm-${Date.now().toString(36)}`
          }
        };
      }

      const reconciliation = reconcileFindings(assembly.findings, validation.value.findings);
      if (reconciliation.rejectedLlmFindings.length > 0) {
        warnings.push(
          `${reconciliation.rejectedLlmFindings.length} LLM claim(s) contradicted a deterministic result and were discarded.`
        );
      }

      const section: ReviewLlmSection = {
        used: true,
        status: 'ok',
        providerId: adapter.config.id,
        model: completion.model,
        rejectedFindings: reconciliation.rejectedLlmFindings.length,
        conflicts: reconciliation.conflicts.length,
        durationMs: Date.now() - startedAtMs
      };
      if (validation.value.summary !== undefined) section.interpretation = validation.value.summary;
      if (validation.value.recommendation !== undefined) section.recommendation = validation.value.recommendation;
      if (validation.value.uncertainty !== undefined) section.uncertainty = validation.value.uncertainty;
      return section;
    } catch (error) {
      const body = toHostError(error, 'llm');
      warnings.push(`LLM interpretation unavailable (${body.code}): ${body.message}`);
      return {
        used: false,
        status: 'failed',
        rejectedFindings: 0,
        conflicts: 0,
        durationMs: Date.now() - startedAtMs,
        error: body
      };
    }
  }
}

const MAX_SIGNATURE_CANDIDATES = 8;

/** Structured, secret-free profile description handed to the model (never the raw profile object). */
export const describeProfileForPrompt = (profile: ValidationProfile): string => {
  const summary = summarizeProfile(profile);
  return [
    `name: ${profile.name}`,
    `tier: ${profile.tier}`,
    `enabled checks: ${summary.enabledChecks.join(', ')}`,
    `disabled checks: ${summary.disabledChecks.length > 0 ? summary.disabledChecks.join(', ') : 'none'}`,
    `minimum match confidence: ${profile.matching.minConfidence}`,
    `maximum candidates: ${profile.matching.maxCandidates}`
  ].join('\n');
};

/** One line per deterministic finding; these are authoritative and the model must not rewrite them. */
export const formatFindings = (findings: readonly Finding[]): string[] =>
  findings.map((finding) => {
    const parts = [`${finding.ruleId} ${finding.status}`];
    if (finding.observed !== undefined) parts.push(`observed=${JSON.stringify(finding.observed)}`);
    if (finding.expected !== undefined) parts.push(`expected=${JSON.stringify(finding.expected)}`);
    if (finding.tolerance !== undefined) parts.push(`tolerance=${JSON.stringify(finding.tolerance)}`);
    if (finding.explanation !== undefined) parts.push(`:: ${finding.explanation}`);
    return parts.join(' ');
  });

export const buildSearchQuery = (evidence: PageElementEvidence): { text: string; role?: string } => {
  const parts = [
    evidence.tagName ?? '',
    evidence.accessibleName ?? '',
    ...(evidence.normalizedClassTokens ?? [])
  ].filter((part) => part !== '');
  return {
    text: parts.slice(0, 6).join(' '),
    ...(evidence.role !== undefined ? { role: evidence.role } : {})
  };
};

/** Tolerates fenced JSON blocks, which some OpenAI-compatible servers still emit. */
export const parseJsonText = (text: string): unknown => {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
