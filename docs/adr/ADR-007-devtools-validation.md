# ADR-007 — Validación de chrome-devtools-mcp (snapshot, CSS, JS, screenshot)

- **Fecha:** 2026-09-17
- **Estado:** Propuesto (pendiente de ejecución)
- **Spec:** §27 decisión pendiente 7 (§7.1, DoD §25)
- **Contexto:** El DoD exige probar Chrome DevTools MCP antes de dar por bueno el flujo de evidencia.
- **Decisión:** Matriz mínima de prueba contra el preset: `snapshot` (a11y tree),
  `get_css_styles` por UID, `evaluate_script` de inspección read-only y `screenshot`
  (página + elemento). Criterio: las 4 devuelven evidencia normalizable sin modificar el DOM.
  Resultado se registra aquí y en el DoD.
- **Alternativas:** dar por válido sin prueba (rechazado).
- **Consecuencias:** bloquea el checklist auditable hasta pasar la matriz; puede forzar perfil aislado (ADR-004).
- **Trazabilidad:** DS-004.
