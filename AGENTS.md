# AGENTS.md — DesAIgnSync

Instrucciones para agentes que trabajen en este repositorio. El estado actual del
proyecto (waves completadas, pendientes y riesgos) vive en `docs/PROGRESS.md`.

## Qué es este producto

Extensión Chrome MCP-first que audita una aplicación web **sin modificarla**: obtiene
evidencia con Chrome DevTools MCP, la contrasta con un Design System expuesto por MCP
(Storybook es un preset) y genera un checklist auditable con reglas determinísticas + LLM.

Cadena que **nunca** debe romperse:
`OBSERVATION → MATCHING → VALIDATION → AI INTERPRETATION → REPORT`.

## Fuentes de verdad (en orden)

1. `docs/AI_Design_System_Compliance_MCP_Spec_v2.1.md` (spec v2.1 en Markdown; el DOCX original en `DOC-spec/` no se toca).
2. `docs/backlog/DS-0XX.md` (los 30 issues, snapshot de GitHub Issues).
3. `docs/adr/ADR-001..ADR-009` (decisiones ya tomadas; no las reviertas sin un ADR nuevo).

Si la spec y un issue se contradicen: prioriza la spec, documenta la discrepancia, no inventes requisitos.

## Estructura

```
apps/extension        MV3 + Side Panel (React) + bridge loopback + picker
apps/local-host       API loopback, MCP Client Manager, LLM adapter, secrets
packages/shared-types contratos compartidos (única fuente de tipos)
packages/core         engines determinísticos: evidence, matching, rules, reporting
packages/mcp-adapters Chrome DevTools / Design System / Storybook
tests/fixtures        servidores MCP y LLM reales (stdio y HTTP) usados por los tests
docs/                 spec, backlog, ADRs, progreso
```

## Comandos

```bash
npm install
npm run typecheck        # tsc -b + tests/tsconfig
npx vitest run           # suites (contra fixtures reales, sin mocks)
npm run host             # arranca el Local MCP Host (imprime pairing code)
npm run extension:build  # Vite -> apps/extension/dist (cargar unpacked en Chrome)
npm run build            # build de todos los workspaces
```

## Reglas duras

- **Read-only**: nunca modificar la app inspeccionada (DOM, estilos, código, datos). El picker solo añade un overlay propio y transitorio.
- **MCP-first**: la extensión no ejecuta `stdio`/`npx`/procesos; todo pasa por el Local MCP Host en loopback autenticado.
- **Secretos**: API keys solo en el credential store del host. Nunca al Side Panel, logs, reportes, exports ni prompts.
- **Clases CSS**: son evidencia secundaria. Nunca identifican un componente por sí solas (`CLASS_SIGNAL_WEIGHT_CAP`).
- **observed / derived / unknown**: nunca mezclar hechos medidos con inferencias; lo faltante queda `undefined` o `NOT_EVALUATED`, jamás inventado.
- **Sin mocks permanentes**: los tests levantan servidores fixture reales (`tests/fixtures/`). Si algo no se puede probar en CI (Chrome real), se documenta como verificación manual.

## Convenciones

- TypeScript estricto, ESM `NodeNext`: imports relativos **con extensión `.js`**.
- Tests con Vitest junto al código (`*.test.ts`); los tests no se emiten (`noEmit`).
- Commits: `feat(ds-0XX): ...` / `test(ds-0XX): ...` / `docs(DS-0XX): ...`, en ramas `feature/ds-0XX-slug` desde `main`.
- No commitear `dist/`, `.tsbuild/`, `node_modules/` ni artefactos compilados en `tests/fixtures/`.
- Comentarios: solo doc corta donde aporta contexto no obvio (la evidencia debe ser auditable).

## Al cerrar una historia

1. Leer el issue completo (`docs/backlog/DS-0XX.md`), 2. implementar, 3. `npm run typecheck`,
4. `npx vitest run`, 5. `npm run build`, 6. commit + push, 7. actualizar `docs/PROGRESS.md` solo si cambia el estado de wave.

## Ownership por wave (evitar colisiones)

| Workstream | Alcance de archivos |
| --- | --- |
| Architecture | `packages/shared-types`, `tsconfig*`, `docs/adr/` |
| Extension | `apps/extension/**` |
| MCP Integrations | `apps/local-host/src/mcp`, `packages/mcp-adapters/**`, `tests/fixtures/**` |
| Intelligence Core | `packages/core/**` |
| AI / Security | `apps/local-host/src/llm`, `apps/local-host/src/security` |
| Integration / QA | `apps/local-host/src/review|reporting`, `tests/**`, `README.md` |

`packages/shared-types` y `apps/local-host/src/http/server.ts` los toca un solo agente a la vez.
