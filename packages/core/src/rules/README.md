# packages/core/src/rules/README.md

Deterministic Rules Engine: color, typography, spacing, shape, dimensions and accessibility
checks with tolerances, emitting PASS / FAIL / REVIEW / NOT_EVALUATED findings that always carry
observed, expected, difference, tolerance and source.

- **Owner:** Agent 4 - Intelligence Core
- **Waves:** Wave 4 (DS-015, done)
- **Status:** implemented; 11 tests covering tolerances (±2px spacing, ±1px radius), WCAG contrast,
  non-native semantics (REVIEW), undeclared states (FAIL) and NOT_EVALUATED for missing evidence.

Sources of truth: `docs/AI_Design_System_Compliance_MCP_Spec_v2.1.md (section 15)` and `docs/backlog/DS-015.md`.
