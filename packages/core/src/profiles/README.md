# packages/core/src/profiles

Validation profiles and Simple/Advanced/Expert modes (DS-017, spec §13).

- `profileCatalog.ts` — `PROFILE_TEMPLATES` (Design QA, Design System Compliance, Accessibility,
  Forms Review, DS Migration, Custom), `TIER_EXPOSURE` (Simple hides tolerances, severities,
  weights and prompt editing), `createProfileFromTemplate()`, `duplicateProfile()`,
  `renameProfile()`, `removeProfileFromList()` (built-ins cannot be deleted),
  `resetProfileToDefaults()`, `updateChecks()`/`updateMatching()` (structured edits never rewrite
  the advanced prompt), `validateProfile()` (rejects invalid weights/confidence/top-N and any
  secret stored inside a profile) and `profileRef()` for report reproducibility.

- **Owner:** Agent 5 - AI / Security (with Agent 4 on check coupling)
- **Waves:** Wave 4 (DS-017, done)
- **Status:** implemented; 10 tests covering tiers, guards, reset and no-secrets rule.

Sources of truth: `docs/AI_Design_System_Compliance_MCP_Spec_v2.1.md` (section 13) and `docs/backlog/DS-017.md`.
