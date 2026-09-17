# ADR-003 — Mapeo de tools variables de Design System MCP a operaciones internas

- **Fecha:** 2026-09-17
- **Estado:** Aceptado
- **Spec:** §27 decisión pendiente 3 (§7.2, §11)
- **Contexto:** Cada Design System MCP expone tools/resources con nombres distintos; el producto no debe acoplarse a una URL de Storybook.
- **Decisión:** **Adapter genérico por capabilities** en `packages/mcp-adapters/design-system`
  (con preset `storybook`): descubre tools/resources al conectar, aplica namespacing,
  traduce a operaciones internas (`listComponents`, `getVariant`, `getTokens`, `getDocs`) y
  puntúa confianza del mapeo. Sin match suficiente → `REVIEW`/`NOT_EVALUATED`, nunca invención.
- **Alternativas:** crawler de Storybook URL como camino principal (rechazado por spec §2/§25);
  mapeo rígido 1:1 por nombre de tool (rechazado: frágil ante previews de API).
- **Consecuencias:** soporta Storybook u otro DS MCP con la misma configuración; exige fixtures y tests del adapter.
- **Trazabilidad:** DS-004 (y futuro adapter DS).
