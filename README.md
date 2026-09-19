# DesAIgnSync — MCP-first Design System Compliance Auditor

> Chrome Side Panel + Local MCP Host + Chrome DevTools MCP + Design System MCP.
> Reglas determinísticas primero, LLM después. Solo lectura sobre la web inspeccionada.

Especificación canónica: `DOC-spec/AI_Design_System_Compliance_MCP_Spec_v2.1.docx`
(conversión Markdown de referencia en `docs/AI_Design_System_Compliance_MCP_Spec_v2.1.md`).
Decisiones arquitectónicas: `docs/adr/`.

## Arquitectura MCP-first

```text
┌─────────────────────┐      loopback HTTP/WS       ┌──────────────────────┐
│ Chrome Extension    │ ◄──────────────────────────► │ Local MCP Host       │
│ (Side Panel + SW)   │  127.0.0.1, token efímero,   │ Node.js / TypeScript │
│ - No lanza procesos │  origin allowlist            │ - MCP Client Manager │
│ - No guarda secrets │                              │ - Router MCP/LLM     │
└─────────────────────┘                              │ - Rules + reporting  │
                                                     └──────┬───────┬───────┘
                                                            │ stdio │ streamable-http
                                              ┌─────────────▼───┐ ┌─▼──────────────────┐
                                              │ Chrome DevTools │ │ Design System MCP  │
                                              │ MCP (snapshot,  │ │ (Storybook preset  │
                                              │ CSS, JS, shot)  │ │ u otro DS MCP)     │
                                              └─────────────────┘ └────────────────────┘
                                                                         │
                                              ┌────────────────────────────▼───────────┐
                                              │ LLM OpenAI-compatible (remoto o local) │
                                              │ configurado en el Host, nunca en la    │
                                              │ extensión.                             │
                                              └────────────────────────────────────────┘
```

| Pieza | Rol | Dónde vive |
| --- | --- | --- |
| Extensión Side Panel (`apps/extension`) | UI Manifest V3, estado de conexión, Inspect / Audit Page, checklist. Cliente del Host, nunca ejecuta `npx`/stdio. | `apps/extension/src/{sidepanel,background,bridge}` |
| Local MCP Host (`apps/local-host`) | Puente loopback autenticado, MCP Client Manager (stdio + streamable-http), orquestación LLM + reglas. | `apps/local-host/src/{mcp,http,security,config,logging}` |
| Chrome DevTools MCP | Fuente preferida de evidencia: snapshot (a11y tree), CSS por UID, `evaluate_script`, screenshots. Preset `npx -y chrome-devtools-mcp@latest --autoConnect`. | vía preset en Host |
| Design System MCP | Referencia esperada (componentes/variantes/tokens). Storybook es un preset, no una URL obligatoria. Adapter genérico por capabilities. | `packages/mcp-adapters` |
| Reglas determinísticas + LLM | `packages/core`: normalización de evidencia, matching probabilístico con confidence, rules engine TS (color, tipo, spacing, radius, dimensiones, a11y básica), reporting. El LLM razona, no mide. | `packages/core`, `packages/shared-types` |

Principios: MCP-first, local-first, read-only by default, evidence-first,
deterministic-before-AI, confidence-aware, user-controlled model, safe prompting
(ver spec §3).

## Orden de ejecución local

1. **Instalar** (requiere Node >= 20.11):
   ```bash
   npm install
   npm run build
   ```
2. **Arrancar el host**:
   ```bash
   npm run host
   # o: node apps/local-host/dist/cli.js
   # health: GET http://127.0.0.1:<puerto>/health -> { version, status }
   ```
3. **Pairing extensión ↔ host**: abre el Side Panel; el Host emite un token
   de sesión efímero, valida `origin`/`chrome-extension://<id>` contra allowlist
   y establece canal HTTP/WebSocket solo en loopback. Sin listener público.
4. **Abrir el Side Panel**: en Chrome, `chrome://extensions` → modo
   desarrollador → `Load unpacked` → `apps/extension/dist` → icono →
   `Open side panel`. El indicador pasa `desconectado → conectando → listo/error`.

Alternativa de mayor aislamiento (futura): Chrome Native Messaging en lugar de
loopback (ver `docs/adr/ADR-002-*`).

## Workspaces y scripts

| Paquete | Descripción |
| --- | --- |
| `apps/extension` | Extensión MV3 + Side Panel (React + TS). |
| `apps/local-host` | Local MCP Host (bin `desaignsync-host`). |
| `packages/core` | Evidence, matching, rules, reporting. |
| `packages/mcp-adapters` | Adapters chrome-devtools / design-system / storybook. |
| `packages/shared-types` | Contratos versionados compartidos. |

```bash
npm run build      # build en todos los workspaces
npm run typecheck  # tsc -b + tests
npm test           # vitest run
npm run host       # arranca el Local Host
npm run extension:build  # build solo extensión
```

## Seguridad (resumen)

- Host solo en `127.0.0.1`/`localhost`; rechaza orígenes no autorizados.
- Secrets (API keys) en credential store del SO; nunca en `chrome.storage` ni en texto plano; nunca se retornan al Side Panel.
- Web/MCP = datos no confiables; no sobrescriben instrucciones; no se envían cookies, tokens, `localStorage` ni HTML completo al LLM.
- Procesos MCP solo desde configuración local confiable; la página inspeccionada no registra MCPs.

## Prueba end-to-end sin Chrome

Emula el flujo completo del Side Panel (host + MCP de Chrome + MCP del Design System + proveedor LLM),
todo local y contra los fixtures reales, e imprime el informe resultante:

```bash
npm run build --workspace @desaignsync/local-host   # una vez
node scripts/emulate-review.mjs
```

Salida esperada (resumen): `Button / Primary · 86% (primary)`, `PASS 8 · FAIL 0`,
interpretación del LLM y `Reproducibilidad: perfil=Design QA · corePrompt v1 (…hash…)`.
Sale con código 0 si el match es fiable y no hay FAIL.

## Estado (DS-001..DS-028)

- **Wave 1** DS-001 Foundation · DS-002 Extensión MV3 + Side Panel · DS-003 Local Host loopback · DS-004 MCP Client Manager.
- **Wave 2** DS-005 Chrome DevTools MCP · DS-006 Design System MCP · DS-007 Storybook preset · DS-008 LLM provider · DS-009 secretos del SO.
- **Wave 3** DS-010 evidencia · DS-011 normalizador de clases · DS-012 element picker · DS-013 ComponentSignature.
- **Wave 4** DS-014 matching con confidence · DS-015 rules con tolerancias · DS-016 prompts protegidos · DS-017 perfiles.
- **Wave 5** DS-018 review end-to-end (+ Side Panel) · DS-028 Settings (MCP/LLM/perfiles) + persistencia.

Pendiente: DS-019 page audit, DS-020 reporte/export, DS-021 Ask AI, DS-022 privacidad, DS-023..DS-030.
Backlog completo en `docs/backlog/DS-*.md`. ADRs en `docs/adr/`.
