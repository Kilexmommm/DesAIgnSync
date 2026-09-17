# packages/core/src/matching

Probabilistic equivalence engine (DS-014, spec §12): ranks Design System candidates against
observed element evidence and produces explainable confidence with a per-signal breakdown.

- `matchingEngine.ts` — `matchElement()` / `MatchingEngine`, `explainMatchResult()`.
- Signals and default weights follow spec §12: semantic .25, structure .15, classes .10 (hard cap),
  css .20, geometry .10, vision .05, docs .05, llm .10. `attributes` defaults to 0 and is Expert-only.
- `no reliable match` is a first-class outcome; nothing is ever forced.
- Confidence is scaled by `MIN_EVIDENCE_COVERAGE`, so a single signal (an LLM hint or a class name)
  can never reach a high score on its own (AC-22).
- Every candidate's `breakdown.weighted` sums to its `confidence`, which keeps reports auditable.

- **Owner:** Agent 4 - Intelligence Core
- **Waves:** Wave 4 (DS-014, done)
- **Status:** implemented; 9 tests against deterministic fixtures.

Sources of truth: `docs/AI_Design_System_Compliance_MCP_Spec_v2.1.md` (section 12) and `docs/backlog/DS-014.md`.
