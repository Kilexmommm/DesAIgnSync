# ADR-006 — Fixture MCP de Design System para desarrollo reproducible

- **Fecha:** 2026-09-17
- **Estado:** Aceptado
- **Spec:** §27 decisión pendiente 6 (§24, prompt §25)
- **Contexto:** Desarrollar sin depender de un Storybook real exige una fuente DS determinista.
- **Decisión:** Crear **fixture MCP de Design System** en `tests/fixtures` (servidor MCP local
  + dataset de componentes/variantes/tokens versionado) consumible por el adapter y el
  matching engine. Junto al existente `mcp-echo-server.mjs` para transporte genérico.
- **Alternativas:** depender siempre de Storybook remoto (rechazado: no reproducible, rompe CI).
- **Consecuencias:** AC y tests de matching corren offline; el fixture debe versionarse con los contratos.
- **Trazabilidad:** DS-001 (tests/fixtures), DS-004.
