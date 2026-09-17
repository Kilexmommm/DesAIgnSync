# ADR-004 — Chrome DevTools MCP: autoConnect por defecto con perfil aislado opcional

- **Fecha:** 2026-09-17
- **Estado:** Aceptado
- **Spec:** §27 decisión pendiente 4 (§7.1)
- **Contexto:** Definir si el preset usa `--autoConnect` o un perfil/navegador aislado para auditoría.
- **Decisión:** Preset por defecto **`npx -y chrome-devtools-mcp@latest --autoConnect`**
  (menor fricción, snapshot/CSS/JS/screenshot sobre la pestaña activa). Settings permite
  cambiar a `browserUrl` o configuración personalizada (perfil aislado) para auditorías
  reproducibles. La evidencia pasa por el normalizador antes de reglas/LLM.
- **Alternativas:** solo perfil aislado (rechazado: fricción V1); inspección propia sin MCP (rechazado: duplica lo que ya da DevTools MCP).
- **Consecuencias:** V1 rápido de probar; el modo aislado queda documentado para QA.
- **Trazabilidad:** DS-004 (preset DevTools).
