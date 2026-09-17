# packages/core/src/prompts

Prompt architecture (DS-016, spec §14): a protected, versioned Core System Prompt plus a user-editable
Advanced Validation Prompt, assembled in a fixed order.

- `corePrompt.ts` — `CORE_SYSTEM_PROMPT` (code constant, no setter), `CORE_PROMPT_VERSION`,
  `CORE_PROMPT_FINGERPRINT`, `DEFAULT_ADVANCED_INSTRUCTIONS`, `validateAdvancedInstructions()`
  (rejects attempts to rewrite the core rules) and `restoreDefaultAdvancedInstructions()`.
- `promptBundle.ts` — `buildPromptBundle()` assembles:
  core → structured profile → advanced instructions → Design System evidence → page evidence →
  deterministic results → task. Page and MCP content is wrapped as untrusted evidence and
  instruction-like text is neutralized. `validateLlmReviewResponse()` enforces the JSON schema and
  `reconcileFindings()` guarantees the LLM can never overwrite a measured PASS/FAIL.

- **Owner:** Agent 5 - AI / Security (prompt layer) + Agent 4 (bundle integration)
- **Waves:** Wave 4 (DS-016, done)
- **Status:** implemented; 10 tests including adversarial page text and core-override attempts.

Sources of truth: `docs/AI_Design_System_Compliance_MCP_Spec_v2.1.md` (sections 14, 26) and `docs/backlog/DS-016.md`.
