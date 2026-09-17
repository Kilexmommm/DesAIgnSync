# PROGRESS.md — contexto compactado

Estado del proyecto al 2026-09-17. Todo pusheado a `github.com/Kilexmommm/DesAIgnSync`
(ver `git log --oneline -1` en `main` para el hash actual). Este archivo es el resumen
durable: sirve para retomar el trabajo sin releer la conversación completa.

## Verificación actual

- `npm run typecheck` → **exit 0**
- `npx vitest run` → **161 tests / 25 suites, 0 fallos** (fixtures MCP y LLM **reales**, sin mocks)
- `npm run extension:build` → `apps/extension/dist` (sidepanel.js + service-worker.js + manifest MV3)
- `node apps/local-host/bin/desaignsync-host.mjs --version` → `0.1.0`

## Waves completadas

| Wave | Issues | Estado | Piezas clave |
| --- | --- | --- | --- |
| 1 — Foundation | DS-001..004 | ✅ mergeado | monorepo npm workspaces + TS project references; MV3 Side Panel; Local MCP Host (`/health`, pairing con rate-limit, API autenticada, WS `/events`); `McpClientManager` stdio + streamable-http con restart/backoff y sin huérfanos |
| 2 — Connections | DS-005..009 | ✅ mergeado | `ChromeMCPAdapter`, `DesignSystemMCPAdapter` (5 operaciones lógicas §11.1), preset Storybook; `LlmProviderAdapter` OpenAI-compatible; `SecretStore` (keychain del SO + fallback AES-256-GCM) |
| 3 — Evidence | DS-010..013 | ✅ mergeado | `normalizeElementEvidence` + `evidenceCoverage`; `classNormalizer` con pesos y `CLASS_SIGNAL_WEIGHT_CAP`; `toComponentSignature` (+`providedFields`/`derivedFields`); picker read-only con permisos opcionales |
| 5 — Vertical slice | DS-018 (+ DS-028, APIs DS-008/DS-017) | ✅ mergeado | `ReviewOrchestrator` (Chrome MCP → evidencia → DS MCP → firmas → matching → reglas → LLM opcional → `ReviewResult`); `elementEvidenceCollector` read-only (sin `value` ni atributos fuera de allowlist); resolución de página por id con fallback por URL; endpoints `/inspection/review`, `/llm/providers*`, `/profiles`; `LlmProviderRegistry` y `ProfileRegistry`; **Side Panel cableado**: selector de perfil, botón Review y vista auditable (`ReviewView`) con match/confidence, checklist por categoría, interpretación IA marcada y warnings. **DS-028**: `ConfigStore` persiste `~/.desaignsync/config.json` (read-modify-write + rechazo defensivo de campos tipo secreto; solo refs llegan al archivo), endpoints `*/remove`, `/profiles/save`, hidratación al arranque (el archivo es la fuente de verdad) y pantalla unificada de Settings en el Side Panel (MCP servers, proveedores LLM con Fetch models + modelo manual + Test, y perfiles con selección del activo) |
| 4 — Intelligence | DS-014..017 | ✅ mergeado | `matchElement`/`MatchingEngine` (9 señales, pesos de §12, tope 10% a clases, `MIN_EVIDENCE_COVERAGE`, `no-reliable-match`); `evaluateRules` con 22 checks y tolerancias ±2px/±1px; `CORE_SYSTEM_PROMPT` protegido + `buildPromptBundle`/`reconcileFindings`; 6 perfiles y modos Simple/Advanced/Expert |

Commits por historia en `main`: `2b6a8be` (DS-011), `310f44d` (DS-010), `ada69a4` (DS-013),
`883d17f` (DS-012), `4035901` (chore), más los merges de Wave 1 y 2.

## Pendiente

**Wave 5 (resto)**: `DS-019` (page audit), `DS-020` (reporting/checklist UI + export), `DS-022` (privacidad/prompt-injection). **DS-028 completado** (settings en el Side Panel + persistencia en el host).

**Nota de milestone**: la experiencia completa ya está cableada — `Select element` (DS-012) → `Review element` → match/confidence + checklist + interpretación IA en el Side Panel, con el trabajo pesado en el host. La verificación con **Chrome real** sigue siendo manual (el MCP no es headless); la automatizada es con fixtures (7 tests e2e host + cliente).
**Waves 6-7**: `DS-021`, `DS-023`, `DS-024`, `DS-025`, `DS-026`, `DS-027`, `DS-029`, `DS-030`.

## Decisiones y discrepancias documentadas

- ADRs 001-008 de la spec §27 + `ADR-009` (permisos del picker: `optional_host_permissions` bajo demanda, no `<all_urls>`).
- **DS-014 declara dependencia de DS-008**, pero el matching debe ser determinístico y funcionar **sin** proveedor LLM (AC-18). La dependencia es de contrato/tipos, no de ejecución.
- **DS-020 depende de DS-019** aunque el plan los pone en waves distintas: mover DS-019 a Wave 5 o DS-020 a Wave 6.
- Reglas determinísticas viven en TS local (`packages/core`), no en el LLM ni como tools MCP.

## Riesgos abiertos

1. **Chrome DevTools MCP no es headless**: DS-018 y DS-024 requieren Chrome real con debugging habilitado; la verificación del vertical slice es manual/instrumentada.
2. **Storybook MCP es preview**: los nombres de tools pueden cambiar; por eso `DesignSystemMCPAdapter` descubre capabilities y traduce a las operaciones lógicas.
3. **`packages/ui` aparcado** (incompleto, fuera de wave): movido a `/var/folders/wp/y15lnkr56b1g17p2c_bbslhc0000gn/T/opencode/desaignsync-ui-parked-20260917/ui`. No se commiteó para no ensuciar `package-lock.json` con un workspace inexistente.
4. **Cuota de subagentes**: los teammates fallaron con 429 (`muse-spark-1.3-contributor`) y pérdida de red; por eso Wave 2 y 3 se implementaron como lead. Los subagentes de opencode están ahora fijados a `opencode-go/glm-5.3-flash`.

## Estado del repo

- Ramas locales/remotas: `main` + `feature/ds-001..ds-017` (todas mergeadas a `main`).
- Interfaz interna del host (§18) implementada: `/health`, `/info`, `/session/pair|renew`, `/mcp/servers`, `/mcp/servers/test`, `/mcp/tools/call`, WS `/events`, `/llm/providers` (GET/POST), `/llm/providers/test`, `/llm/providers/models`, `/profiles`, `/inspection/review`. Falta `/inspection/snapshot|screenshot` y `/reports/export` (Wave 5-6).
- Secretos: `DESAIGNSYNC_SECRET_BACKEND=file` fuerza el fallback cifrado (CI/headless); el backend del keychain del SO ahora usa `spawn` + stdin con timeout de 10s (antes `execFile` no enviaba el secreto y bloqueaba).
- Sin labels/milestones en los GitHub Issues (el board "DesAIgnSync (Todo)" existe).
- Nota: otra sesión/agente ha estado tocando `packages/ui/` en paralelo (timestamps recientes);
  sigue sin trackear y sus scripts de Storybook se revirtieron de `package.json`.
