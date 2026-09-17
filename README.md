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

## Estado (DS-001..DS-004)

- DS-001 Foundation: monorepo, workspaces, build/test/typecheck.
- DS-002 Extensión MV3 con Side Panel.
- DS-003 Local Host + bridge loopback seguro.
- DS-004 MCP Client Manager genérico (stdio + HTTP).

Backlog completo en `docs/backlog/DS-*.md`. ADRs en `docs/adr/`.
