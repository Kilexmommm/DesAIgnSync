# packages/core/src/evidence

Evidence normalization (DS-010) and CSS class normalization (DS-011).

- `classNormalizer.ts` — keeps raw class names for auditability, splits kebab/snake/camel/Pascal
  and CSS Modules names, downweights generated/hashed/utility tokens and exposes
  `CLASS_SIGNAL_WEIGHT_CAP` so DS-014 never lets classes alone decide a match (spec §12.1, AC-22/AC-23).
- `normalizeElementEvidence.ts` — turns loose Chrome DevTools MCP output into the versioned
  `PageElementEvidence` model (tag, role/ARIA, input type, attributes, raw + normalized classes,
  parent/child context, computed styles, geometry). Values that are not observed stay `undefined`;
  `evidenceCoverage()` tells matching when to answer REVIEW instead of FAIL (AC-21).

- **Owner:** Agent 4 — Intelligence Core
- **Issues:** DS-010, DS-011 (Wave 3)
- **Tests:** `classNormalizer.test.ts`, `normalizeElementEvidence.test.ts`

Sources of truth: `docs/AI_Design_System_Compliance_MCP_Spec_v2.1.md` (§10, §12) and
`docs/backlog/DS-010.md`, `docs/backlog/DS-011.md`.
